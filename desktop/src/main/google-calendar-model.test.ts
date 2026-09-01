import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { mapGoogleEvent } from './google-calendar-model.ts'

test('maps a timed event with stable account-scoped identity', () => {
  const event = mapGoogleEvent({ id: 'event-1', summary: 'Planning', start: { dateTime: '2026-08-30T09:00:00Z' }, end: { dateTime: '2026-08-30T10:00:00Z' } }, 'connection-1', 'user@example.com')
  assert.equal(event?.sourceId, 'connection-1:primary:event-1')
  assert.equal(event?.calendarId, 'primary')
  assert.equal(event?.allDay, false)
})

test('maps all-day events and ignores cancelled events', () => {
  const event = mapGoogleEvent({ id: 'event-2', start: { date: '2026-08-30' }, end: { date: '2026-08-31' } }, 'connection-2', 'user@example.com')
  assert.equal(event?.allDay, true)
  assert.equal(event?.title, 'Untitled event')
  assert.equal(mapGoogleEvent({ id: 'event-2', status: 'cancelled' }, 'connection-2', 'user@example.com'), null)
})
