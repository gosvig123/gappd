import { randomUUID } from 'node:crypto'
import type { CalendarConnection, CalendarEventSummary, CalendarSnapshot, CalendarHistoryRange } from '../../shared/calendar-contract'
import type { OAuthTokenSet } from '../oauth'

const READY_STATUS = 'ready'
const SYNCING_STATUS = 'syncing'
const ERROR_STATUS = 'error'
// Background syncs fetch past Meeting windows again only this often; they rarely change.
const HISTORY_REFRESH_MS = 24 * 60 * 60 * 1000

export type StoredCalendarConnection = {
  id: string
  subject: string
  email: string
  tokens: OAuthTokenSet
  historyRanges?: CalendarHistoryRange[]
  historicalEvents?: CalendarEventSummary[]
  historyCheckedAt?: string
  historyError?: string
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
  refresh?(tokens: OAuthTokenSet): Promise<OAuthTokenSet>
  sync(connectionId: string, email: string, tokens: OAuthTokenSet, includeHistory?: boolean): Promise<{ tokens: OAuthTokenSet; events: CalendarEventSummary[]; historicalEvents?: CalendarEventSummary[]; historyRanges?: CalendarHistoryRange[]; historyError?: string }>
  revoke(tokens: OAuthTokenSet): Promise<void>
}

export class GoogleCalendarServiceCore {
  private connecting: Promise<CalendarSnapshot> | null = null
  private authorizationVersion = 0
  private queue = Promise.resolve()
  private readonly syncing = new Map<string, Promise<CalendarSnapshot>>()
  private readonly listeners = new Set<(snapshot: CalendarSnapshot) => void>()
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
    if (!this.connecting) this.connecting = this.performConnect(++this.authorizationVersion).finally(() => { this.connecting = null })
    return this.connecting
  }

  subscribe(listener: (snapshot: CalendarSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Syncs every account in turn; failures stay on their account, and history is fetched only when it is due. */
  async backgroundSync(): Promise<void> {
    await this.queue
    const document = await this.readDocument()
    for (const connection of document.connections) {
      await this.sync(connection.id, this.historyDue(connection)).catch(() => undefined)
    }
  }

  sync(connectionId: string, includeHistory = true): Promise<CalendarSnapshot> {
    const current = this.syncing.get(connectionId)
    if (current) return current
    const operation = this.withStore(() => this.performSync(connectionId, includeHistory))
    const request = operation.finally(() => { this.syncing.delete(connectionId); this.publish() }).then(() => this.snapshot())
    this.syncing.set(connectionId, request)
    return request
  }

  disconnect(connectionId: string): Promise<CalendarSnapshot> {
    this.authorizationVersion++
    return this.withStore(async () => {
      const document = await this.readDocument()
      const connection = document.connections.find((item) => item.id === connectionId)
      if (connection) await this.api.revoke(connection.tokens).catch(() => undefined)
      document.connections = document.connections.filter((item) => item.id !== connectionId)
      await this.store.write(document)
      return this.toSnapshot(document)
    }).finally(() => this.publish())
  }

  private async performConnect(version: number): Promise<CalendarSnapshot> {
    const authorized = await this.api.authorize()
    const { document, connectionId } = await this.withStore(async () => {
      if (version !== this.authorizationVersion) throw new Error('The Google connection changed during authorization. Connect again.')
      const document = await this.readDocument()
      const existing = document.connections.find((item) => item.subject === authorized.subject)
      const connection = existing || newConnection(authorized.subject, authorized.email, authorized.tokens)
      Object.assign(connection, { email: authorized.email, tokens: authorized.tokens, error: undefined })
      if (!existing) document.connections.push(connection)
      await this.store.write(document)
      return { document, connectionId: connection.id }
    })
    // Return the account while its first sync runs; the sync stores its own result or error.
    void this.sync(connectionId).catch(() => undefined)
    return this.toSnapshot(document)
  }

  private publish(): void {
    if (!this.listeners.size) return
    void this.snapshot().then((snapshot) => { for (const listener of this.listeners) listener(snapshot) }, () => undefined)
  }

  private historyDue(connection: StoredCalendarConnection): boolean {
    const checkedAt = Date.parse(connection.historyCheckedAt ?? '')
    return !Number.isFinite(checkedAt) || this.now().getTime() - checkedAt >= HISTORY_REFRESH_MS
  }

  private async performSync(connectionId: string, includeHistory: boolean): Promise<void> {
    const document = await this.readDocument()
    const connection = requiredConnection(document, connectionId)
    try {
      const result = await this.api.sync(connection.id, connection.email, connection.tokens, includeHistory)
      const syncedAt = this.now().toISOString()
      if (includeHistory) {
        Object.assign(connection, {
          historicalEvents: result.historicalEvents ?? connection.historicalEvents,
          historyRanges: result.historyRanges ?? connection.historyRanges,
          historyCheckedAt: syncedAt, historyError: result.historyError,
        })
      }
      // An incomplete history stays visible until a later history fetch succeeds.
      Object.assign(connection, { tokens: result.tokens, events: result.events, lastSyncedAt: syncedAt, error: connection.historyError })
      await this.store.write(document)
    } catch (error) {
      connection.error = safeError(error)
      await this.store.write(document)
      throw new Error(connection.error)
    }
  }

  private toSnapshot(document: CalendarDocument): CalendarSnapshot {
    const connections = document.connections.map((connection) => this.toConnection(connection))
    const events = document.connections.flatMap((connection) => [...new Map([...(connection.historicalEvents ?? []), ...connection.events].map(event => [event.sourceId, event])).values()])
      .sort((left, right) => left.start.localeCompare(right.start))
    return { configured: this.api.configured(), connections, events }
  }

  private toConnection(connection: StoredCalendarConnection): CalendarConnection {
    const status = this.syncing.has(connection.id) ? SYNCING_STATUS : connection.error ? ERROR_STATUS : READY_STATUS
    return {
      id: connection.id, email: connection.email, status,
      historyRanges: connection.historyRanges, lastSyncedAt: connection.lastSyncedAt, error: connection.error,
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
