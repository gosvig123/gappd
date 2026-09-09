import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GoogleCalendarServiceCore, type CalendarApi, type CalendarDocument, type CalendarStore } from './google-calendar-service-core.ts'

const NOW = new Date('2026-08-30T14:00:00Z')

test('keeps multiple accounts independent and disconnects only one', async () => {
  const accounts = [account('subject-1', 'work@example.com'), account('subject-2', 'home@example.com')]
  const revoked: string[] = []
  const api: CalendarApi = {
    configured: () => true,
    authorize: async () => accounts.shift()!,
    sync: async (id, email, tokens) => ({ tokens, events: [calendarEvent(id, email)] }),
    revoke: async (tokens) => { revoked.push(tokens.refreshToken || '') },
  }
  const service = new GoogleCalendarServiceCore(api, memoryStore(), () => NOW)
  await service.connect()
  const connected = await service.connect()
  assert.deepEqual(connected.connections.map((item) => item.email).sort(), ['home@example.com', 'work@example.com'])
  assert.equal(connected.events.length, 2)
  const work = connected.connections.find((item) => item.email === 'work@example.com')!
  const disconnected = await service.disconnect(work.id)
  assert.deepEqual(disconnected.connections.map((item) => item.email), ['home@example.com'])
  assert.equal(disconnected.events[0].accountEmail, 'home@example.com')
  assert.deepEqual(revoked, ['refresh-subject-1'])
})

test('preserves cached events and records a safe account-local sync error', async () => {
  const document: CalendarDocument = {
    version: 1,
    connections: [{
      id: 'connection-1', subject: 'subject-1', email: 'work@example.com', tokens: tokens('subject-1'),
      events: [calendarEvent('connection-1', 'work@example.com')],
    }],
  }
  const api: CalendarApi = {
    configured: () => true,
    authorize: async () => account('unused', 'unused@example.com'),
    sync: async () => { throw new Error('Reconnect this account to continue.') },
    revoke: async () => undefined,
  }
  const service = new GoogleCalendarServiceCore(api, memoryStore(document), () => NOW)
  await assert.rejects(service.sync('connection-1'), /Reconnect this account/)
  const snapshot = await service.snapshot()
  assert.equal(snapshot.connections[0].status, 'error')
  assert.equal(snapshot.connections[0].error, 'Reconnect this account to continue.')
  assert.equal(snapshot.events.length, 1)
})

function memoryStore(initial: CalendarDocument | null = null): CalendarStore {
  let document = initial
  return {
    read: async () => structuredClone(document),
    write: async (value) => { document = structuredClone(value) },
  }
}

function account(subject: string, email: string) {
  return { subject, email, tokens: tokens(subject) }
}

function tokens(subject: string) {
  return { accessToken: `access-${subject}`, refreshToken: `refresh-${subject}`, expiresAt: NOW.getTime() + 60_000, tokenType: 'Bearer' }
}

function calendarEvent(connectionId: string, email: string) {
  return {
    connectionId, accountEmail: email, calendarId: 'primary' as const, eventId: `event-${email}`,
    sourceId: `${connectionId}:primary:event-${email}`, title: 'Planning',
    start: '2026-08-30T15:00:00Z', end: '2026-08-30T16:00:00Z', allDay: false, status: 'confirmed',
  }
}

test('historical cache is replaced on success, retained on failure and removed on disconnect', async () => {
  let fail = false
  let removed = false
  const api: CalendarApi = {
    configured: () => true, authorize: async () => account('work', 'work@example.com'), revoke: async () => undefined,
    sync: async (id, email, tokens) => ({ tokens, events: [], historicalEvents: fail ? undefined : removed ? [] : [calendarEvent(id, email)], historyRanges: fail ? undefined : [{ start: 1, end: 2 }], historyError: fail ? 'Calendar history incomplete' : undefined }),
  }
  const service = new GoogleCalendarServiceCore(api, memoryStore(), () => NOW)
  const connected = await service.connect()
  const id = connected.connections[0].id
  assert.equal(connected.events.length, 1)
  fail = true
  const partial = await service.sync(id)
  assert.equal(partial.events.length, 1)
  assert.equal(partial.connections[0].error, 'Calendar history incomplete')
  assert.deepEqual(partial.connections[0].historyRanges, [{ start: 1, end: 2 }])
  fail = false; removed = true
  assert.equal((await service.sync(id)).events.length, 0)
  removed = false
  await service.sync(id)
  assert.equal((await service.disconnect(id)).events.length, 0)
})

// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GoogleCalendarApi } from './google-calendar-api.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { historicalCalendarRanges } from './calendar-history-ranges.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { reconcileAgendaHistory } from '../shared/calendar-reconciliation.ts'

test('connecting Calendar fetches and reconciles an existing local Meeting automatically', async () => {
  const meeting = { id: 'old', title: 'Old recording', startedAt: '2025-01-01T12:00:00Z', endedAt: '2025-01-01T13:00:00Z', emails: [] }
  const reads: string[] = []
  const google = new GoogleCalendarApi({
    clientId: 'public-client', now: () => NOW.getTime(), openExternal: async () => undefined, tokenRequester: async () => ({ ...tokens('work'), expiresAt: NOW.getTime() + 3_600_000 }),
    historyRanges: async () => historicalCalendarRanges([meeting], NOW.getTime()),
    fetcher: async input => {
      const start = new URL(String(input)).searchParams.get('timeMin')!; reads.push(start)
      return Response.json({ items: Date.parse(start) === Date.parse(meeting.startedAt) ? [{ id: 'old-event', start: { dateTime: meeting.startedAt }, end: { dateTime: meeting.endedAt }, attendees: [{ email: 'partner@example.com' }] }] : [] })
    },
  })
  const api: CalendarApi = { configured: () => true, authorize: async () => account('work', 'work@example.com'), sync: (...args) => google.sync(...args), revoke: async () => undefined }
  const service = new GoogleCalendarServiceCore(api, memoryStore(), () => NOW)
  const connected = await service.connect()
  assert.ok(reads.some(start => Date.parse(start) === Date.parse(meeting.startedAt)))
  const history = reconcileAgendaHistory([meeting], {}, connected)
  assert.deepEqual(history[0].emails, ['partner@example.com'])
  assert.equal(history[0].calendarProvenance, 'inferred')
  const disconnected = await service.disconnect(connected.connections[0].id)
  assert.deepEqual(reconcileAgendaHistory([meeting], {}, disconnected)[0].emails, [])
})
