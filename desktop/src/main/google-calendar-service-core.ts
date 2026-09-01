import { randomUUID } from 'node:crypto'
import type { CalendarConnection, CalendarEventSummary, CalendarSnapshot } from '../shared/calendar-contract'
import type { OAuthTokenSet } from './oauth'

const READY_STATUS = 'ready'
const SYNCING_STATUS = 'syncing'
const ERROR_STATUS = 'error'

export type StoredCalendarConnection = {
  id: string
  subject: string
  email: string
  tokens: OAuthTokenSet
  events: CalendarEventSummary[]
  lastSyncedAt?: string
  error?: string
}
export type CalendarDocument = { version: 1; connections: StoredCalendarConnection[] }
export type CalendarStore = {
  read(): Promise<CalendarDocument | null>
  write(value: CalendarDocument): Promise<void>
}
export type CalendarApi = {
  configured(): boolean
  authorize(): Promise<{ subject: string; email: string; tokens: OAuthTokenSet }>
  sync(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<{ tokens: OAuthTokenSet; events: CalendarEventSummary[] }>
  revoke(tokens: OAuthTokenSet): Promise<void>
}

export class GoogleCalendarServiceCore {
  private connecting: Promise<CalendarSnapshot> | null = null
  private queue = Promise.resolve()
  private readonly syncing = new Map<string, Promise<CalendarSnapshot>>()
  private readonly api: CalendarApi
  private readonly store: CalendarStore
  private readonly now: () => Date

  constructor(api: CalendarApi, store: CalendarStore, now: () => Date = () => new Date()) {
    this.api = api
    this.store = store
    this.now = now
  }

  async snapshot(): Promise<CalendarSnapshot> {
    await this.queue
    return this.toSnapshot(await this.readDocument())
  }

  connect(): Promise<CalendarSnapshot> {
    if (!this.connecting) this.connecting = this.performConnect().finally(() => { this.connecting = null })
    return this.connecting
  }

  sync(connectionId: string): Promise<CalendarSnapshot> {
    const current = this.syncing.get(connectionId)
    if (current) return current
    const operation = this.withStore(() => this.performSync(connectionId))
    const request = operation.finally(() => this.syncing.delete(connectionId)).then(() => this.snapshot())
    this.syncing.set(connectionId, request)
    return request
  }

  disconnect(connectionId: string): Promise<CalendarSnapshot> {
    return this.withStore(async () => {
      const document = await this.readDocument()
      const connection = document.connections.find((item) => item.id === connectionId)
      if (connection) await this.api.revoke(connection.tokens).catch(() => undefined)
      document.connections = document.connections.filter((item) => item.id !== connectionId)
      await this.store.write(document)
      return this.toSnapshot(document)
    })
  }

  private async performConnect(): Promise<CalendarSnapshot> {
    const authorized = await this.api.authorize()
    const connectionId = await this.withStore(async () => {
      const document = await this.readDocument()
      const existing = document.connections.find((item) => item.subject === authorized.subject)
      const connection = existing || newConnection(authorized.subject, authorized.email, authorized.tokens)
      Object.assign(connection, { email: authorized.email, tokens: authorized.tokens, error: undefined })
      if (!existing) document.connections.push(connection)
      await this.store.write(document)
      return connection.id
    })
    return this.sync(connectionId)
  }

  private async performSync(connectionId: string): Promise<void> {
    const document = await this.readDocument()
    const connection = requiredConnection(document, connectionId)
    try {
      const result = await this.api.sync(connection.id, connection.email, connection.tokens)
      Object.assign(connection, {
        tokens: result.tokens, events: result.events,
        lastSyncedAt: this.now().toISOString(), error: undefined,
      })
      await this.store.write(document)
    } catch (error) {
      connection.error = safeError(error)
      await this.store.write(document)
      throw new Error(connection.error)
    }
  }

  private toSnapshot(document: CalendarDocument): CalendarSnapshot {
    const connections = document.connections.map((connection) => this.toConnection(connection))
    const events = document.connections.flatMap((connection) => connection.events)
      .sort((left, right) => left.start.localeCompare(right.start))
    return { configured: this.api.configured(), connections, events }
  }

  private toConnection(connection: StoredCalendarConnection): CalendarConnection {
    const status = this.syncing.has(connection.id) ? SYNCING_STATUS : connection.error ? ERROR_STATUS : READY_STATUS
    return {
      id: connection.id, email: connection.email, status,
      lastSyncedAt: connection.lastSyncedAt, error: connection.error,
    }
  }

  private async readDocument(): Promise<CalendarDocument> {
    const document = await this.store.read()
    if (!document) return { version: 1, connections: [] }
    if (document.version !== 1 || !Array.isArray(document.connections)) throw new Error('Encrypted Calendar data is invalid.')
    return document
  }

  private async withStore<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await action() }
    finally { release() }
  }
}

function newConnection(subject: string, email: string, tokens: OAuthTokenSet): StoredCalendarConnection {
  return { id: randomUUID(), subject, email, tokens, events: [] }
}

function requiredConnection(document: CalendarDocument, connectionId: string): StoredCalendarConnection {
  const connection = document.connections.find((item) => item.id === connectionId)
  if (!connection) throw new Error('Google Calendar connection was not found.')
  return connection
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Google Calendar operation failed.'
  return message.slice(0, 240)
}
