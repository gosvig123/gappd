import { randomUUID } from 'node:crypto'
import type { CalendarConnection, CalendarSnapshot } from '../shared/calendar-contract'
import { createSecureStore } from './electron-secure-store'
import { authorizeGoogleAccount, fetchGoogleCalendar, googleCalendarConfigured, revokeGoogleAuthorization } from './google-calendar-api'
import type { OAuthTokenSet } from './oauth'
import type { CalendarEventSummary } from '../shared/calendar-contract'

const CALENDAR_STORE_FILE = 'google-calendar.enc'
const READY_STATUS = 'ready'
const SYNCING_STATUS = 'syncing'
const ERROR_STATUS = 'error'

type StoredConnection = {
  id: string
  subject: string
  email: string
  tokens: OAuthTokenSet
  events: CalendarEventSummary[]
  lastSyncedAt?: string
  error?: string
}
type CalendarDocument = { version: 1; connections: StoredConnection[] }

let connecting: Promise<CalendarSnapshot> | null = null
let storeQueue = Promise.resolve()
const syncing = new Map<string, Promise<CalendarSnapshot>>()

export async function googleCalendarSnapshot(): Promise<CalendarSnapshot> {
  await storeQueue
  const document = await readDocument()
  return toSnapshot(document)
}

export function connectGoogleCalendar(): Promise<CalendarSnapshot> {
  if (!connecting) connecting = performConnect().finally(() => { connecting = null })
  return connecting
}

export function syncGoogleCalendar(connectionId: string): Promise<CalendarSnapshot> {
  const current = syncing.get(connectionId)
  if (current) return current
  const operation = withStore(() => performSync(connectionId))
  const request = operation.finally(() => syncing.delete(connectionId)).then(googleCalendarSnapshot)
  syncing.set(connectionId, request)
  return request
}

export async function disconnectGoogleCalendar(connectionId: string): Promise<CalendarSnapshot> {
  return withStore(async () => {
    const document = await readDocument()
    const connection = document.connections.find((item) => item.id === connectionId)
    if (connection) await revokeGoogleAuthorization(connection.tokens)
    document.connections = document.connections.filter((item) => item.id !== connectionId)
    await writeDocument(document)
    return toSnapshot(document)
  })
}

async function performConnect(): Promise<CalendarSnapshot> {
  const authorized = await authorizeGoogleAccount()
  const connectionId = await withStore(async () => {
    const document = await readDocument()
    const existing = document.connections.find((connection) => connection.subject === authorized.subject)
    const connection = existing || newConnection(authorized.subject, authorized.email, authorized.tokens)
    Object.assign(connection, { email: authorized.email, tokens: authorized.tokens, error: undefined })
    if (!existing) document.connections.push(connection)
    await writeDocument(document)
    return connection.id
  })
  return syncGoogleCalendar(connectionId)
}

async function performSync(connectionId: string): Promise<CalendarSnapshot> {
  const document = await readDocument()
  const connection = requiredConnection(document, connectionId)
  try {
    const result = await fetchGoogleCalendar(connection.id, connection.email, connection.tokens)
    Object.assign(connection, { tokens: result.tokens, events: result.events, lastSyncedAt: new Date().toISOString(), error: undefined })
    await writeDocument(document)
    return toSnapshot(document)
  } catch (error) {
    connection.error = safeError(error)
    await writeDocument(document)
    throw new Error(connection.error)
  }
}

function toSnapshot(document: CalendarDocument): CalendarSnapshot {
  const connections = document.connections.map(toConnection)
  const events = document.connections.flatMap((connection) => connection.events).sort((left, right) => left.start.localeCompare(right.start))
  return { configured: googleCalendarConfigured(), connections, events }
}

function toConnection(connection: StoredConnection): CalendarConnection {
  const status = syncing.has(connection.id) ? SYNCING_STATUS : connection.error ? ERROR_STATUS : READY_STATUS
  return { id: connection.id, email: connection.email, status, lastSyncedAt: connection.lastSyncedAt, error: connection.error }
}

function newConnection(subject: string, email: string, tokens: OAuthTokenSet): StoredConnection {
  return { id: randomUUID(), subject, email, tokens, events: [] }
}

function requiredConnection(document: CalendarDocument, connectionId: string): StoredConnection {
  const connection = document.connections.find((item) => item.id === connectionId)
  if (!connection) throw new Error('Google Calendar connection was not found.')
  return connection
}

async function readDocument(): Promise<CalendarDocument> {
  return await calendarStore().read() || { version: 1, connections: [] }
}

function writeDocument(document: CalendarDocument): Promise<void> {
  return calendarStore().write(document)
}

function calendarStore() {
  return createSecureStore<CalendarDocument>(CALENDAR_STORE_FILE)
}

async function withStore<T>(action: () => Promise<T>): Promise<T> {
  const previous = storeQueue
  let release!: () => void
  storeQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await action() }
  finally { release() }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Google Calendar operation failed.'
  return message.slice(0, 240)
}
