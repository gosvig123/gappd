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
