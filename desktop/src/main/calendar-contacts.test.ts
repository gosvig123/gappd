import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarAttendee, CalendarEventSummary } from '../shared/calendar-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { collectCalendarContacts } from '../shared/calendar-contacts.ts'

const base = { connectionId: 'work', accountEmail: 'me@example.com', calendarId: 'primary' as const, start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z', allDay: false, status: 'confirmed' }

function event(sourceId: string, attendees: CalendarAttendee[]): CalendarEventSummary {
  return { ...base, sourceId, eventId: sourceId, title: sourceId, attendees }
}

test('collects invitees from every cached event and dedupes by email', () => {
  const contacts = collectCalendarContacts([
    event('a', [{ email: ' Partner@Example.com ' }, { email: 'solo@example.com' }]),
    event('b', [{ email: 'partner@example.com', name: '  Pat   Partner ' }]),
  ])
  assert.deepEqual(contacts, [{ email: 'partner@example.com', name: 'Pat Partner' }, { email: 'solo@example.com' }])
})

test('drops the connected account, self attendees, and unusable addresses', () => {
  const contacts = collectCalendarContacts([event('a', [
    { email: 'me@example.com' },
    { email: ' ME@Example.com ' },
    { email: 'me@example.com', self: true },
    { email: 'not-an-email' },
    { email: '   ' },
    { email: 'real@example.com' },
  ])])
  assert.deepEqual(contacts, [{ email: 'real@example.com' }])
})

test('keeps a name found on any later event for the same address', () => {
  const contacts = collectCalendarContacts([
    event('a', [{ email: 'late@example.com' }]),
    event('b', [{ email: 'late@example.com', name: 'Late Name' }]),
    event('c', [{ email: 'late@example.com' }]),
  ])
  assert.deepEqual(contacts, [{ email: 'late@example.com', name: 'Late Name' }])
})

test('caps the contact list for the speaker picker', () => {
  const attendees: CalendarAttendee[] = Array.from({ length: 500 }, (_value, index) => ({ email: `person${String(index).padStart(3, '0')}@example.com` }))
  assert.equal(collectCalendarContacts([event('a', attendees)]).length, 300)
})

test('returns no contacts without a connection or invitees', () => {
  assert.deepEqual(collectCalendarContacts([]), [])
  assert.deepEqual(collectCalendarContacts([event('a', [])]), [])
})

test('reaches past and future events, not just this Meeting', () => {
  const contacts = collectCalendarContacts([
    event('past', [{ email: 'past@example.com', name: 'Past Person' }]),
    event('future', [{ email: 'future@example.com' }]),
  ])
  assert.deepEqual(contacts, [{ email: 'future@example.com' }, { email: 'past@example.com', name: 'Past Person' }])
})
