import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { SavedPerson } from '../shared/participant-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { personOptions } from '../renderer/routes/speaker-options.ts'

const event: CalendarEventSummary = {
  connectionId: 'work', accountEmail: 'me@example.com', calendarId: 'primary', sourceId: 'work:primary:standup', eventId: 'standup',
  title: 'Standup', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z', allDay: false, status: 'confirmed',
  attendees: [{ email: 'sarah@example.com', name: 'Sarah Chen' }],
}
const people: SavedPerson[] = [
  { id: 'sam', name: 'Sam Reed', email: 'sam@example.com' },
  { id: 'sarah', name: 'Sarah Chen', email: 'sarah@example.com' },
]

test('offers Calendar contacts after this Meeting invitees and saved people', () => {
  const options = personOptions(people, event, [{ email: 'omar@example.com', name: 'Omar Diaz' }])
  assert.deepEqual(options.map(option => [option.name, option.invited ?? false, option.saved ?? false]), [
    ['Sarah Chen', true, true],
    ['Sam Reed', false, true],
    ['Omar Diaz', false, false],
  ])
})

test('leaves a saved person unmarked when only another event lists them', () => {
  const options = personOptions(people, undefined, [{ email: 'SARAH@example.com' }])
  assert.deepEqual(options.map(option => option.value), ['sam', 'sarah'])
  assert.equal(options[1].invited, undefined)
})

test('carries the invitee email so labelling can reuse the person later', () => {
  assert.deepEqual(personOptions([], event, []), [
    { value: 'attendee:sarah@example.com', name: 'Sarah Chen', email: 'sarah@example.com', invited: true },
  ])
})

test('falls back to the email as the display name', () => {
  assert.equal(personOptions([], undefined, [{ email: 'unknown@example.com' }])[0].name, 'unknown@example.com')
})

test('keeps saved people selectable without a Calendar connection', () => {
  assert.deepEqual(personOptions(people).map(option => option.value), ['sam', 'sarah'])
})
