import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { AgendaHistory } from '../shared/meeting-agenda'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { calendarEventIsUpcoming, inviteeEmails, matchAgendaHistory } from '../shared/meeting-agenda.ts'

const event: CalendarEventSummary = { connectionId: 'work', accountEmail: 'me@example.com', calendarId: 'primary', eventId: 'next', sourceId: 'next', title: 'Planning', start: '2026-09-10T12:00:00Z', end: '2026-09-10T13:00:00Z', allDay: false, status: 'confirmed', attendees: [{ email: ' ME@example.com ', self: true }, { email: ' Partner@Example.com ' }] }
const now = Date.parse('2026-09-10T09:00:00Z')
const source = (id: string, emails: string[], startedAt = '2026-09-09T12:00:00Z'): AgendaHistory => ({ id, title: id, startedAt, emails })

test('normalizes exact invitee addresses without alias or name inference', () => {
  assert.deepEqual(inviteeEmails(event, []), ['partner@example.com'])
  const history = [source('match', [' PARTNER@EXAMPLE.COM ']), source('alias', ['partner+tag@example.com']), source('name', ['Partner'])]
  assert.deepEqual(matchAgendaHistory(event, history, [], now).map(item => item.id), ['match'])
})

test('excludes self-only, unrelated, future and invalid-date history', () => {
  const history = [source('self', ['me@example.com']), source('other', ['other@example.com']), source('future', ['partner@example.com'], event.start), source('invalid', ['partner@example.com'], 'bad')]
  assert.deepEqual(matchAgendaHistory(event, history, [], now), [])
  assert.deepEqual(matchAgendaHistory({ ...event, attendees: [{ email: event.accountEmail }] }, [source('self', [event.accountEmail])], [], now), [])
})

test('excludes other connected and historical self addresses', () => {
  const target = { ...event, attendees: [{ email: 'personal@example.com' }] }
  assert.deepEqual(matchAgendaHistory(target, [source('self', ['personal@example.com'])], ['personal@example.com'], now), [])
  const history = [{ ...source('old', ['personal@example.com']), event: { ...event, accountEmail: 'personal@example.com' } }]
  assert.deepEqual(matchAgendaHistory(target, history, [], now), [])
})

test('keeps recent resolution context and prioritizes same-series evidence within limit', () => {
  const history = Array.from({ length: 16 }, (_, index) => source(`meeting-${index}`, ['partner@example.com'], `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00Z`))
  history[0].event = { ...event, recurringEventId: 'series' }
  history.push({ ...source('unrelated-series', ['other@example.com']), event: { ...event, recurringEventId: 'series' } })
  const matched = matchAgendaHistory({ ...event, recurringEventId: 'series' }, history, [], now).map(item => item.id)
  assert.equal(matched.length, 12)
  assert.ok(matched.includes('meeting-0'))
  for (let index = 10; index < 16; index++) assert.ok(matched.includes(`meeting-${index}`))
  assert.ok(!matched.includes('unrelated-series'))
})

test('upcoming visibility supports future dates and local all-day boundaries', () => {
  assert.equal(calendarEventIsUpcoming(event, new Date(now)), true)
  assert.equal(calendarEventIsUpcoming(event, new Date(event.end)), false)
  const day = { ...event, allDay: true, start: '2026-09-10', end: '2026-09-11' }
  assert.equal(calendarEventIsUpcoming(day, new Date(2026, 8, 10, 23)), true)
  assert.equal(calendarEventIsUpcoming(day, new Date(2026, 8, 11)), false)
})
