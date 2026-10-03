import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { agendaDraftCanGenerate, agendaDraftEvent, missingAgendaSourceIds, savedAgendaDraftsOutsideUpcoming } from '../shared/agenda-draft.ts'
import type { AgendaDraftRecord } from '../shared/agenda-draft'
import type { CalendarEventSummary } from '../shared/calendar-contract'

function event(sourceId: string, start: string, end: string): CalendarEventSummary {
  return { sourceId, eventId: sourceId, status: 'confirmed', connectionId: 'account', accountEmail: 'self@example.com', calendarId: 'primary', title: `Event ${sourceId}`, start, end, allDay: false }
}

function record(sourceId: string, sourceIds: string[]): AgendaDraftRecord {
  return {
    draftKey: `self@example.com:primary:${sourceId}`, sourceId, title: `Agenda ${sourceId}`, accountEmail: 'self@example.com', eventStart: '2026-09-10T10:00:00.000Z', eventEnd: '2026-09-10T11:00:00.000Z',
    items: [], sources: sourceIds.map((id) => ({ id, title: `Meeting ${id}`, startedAt: '2026-09-01T10:00:00.000Z' })),
    historyIncomplete: false, generatedAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z', model: 'gpt-5.6-terra', reasoningEffort: 'medium', revision: 1,
  }
}

const now = new Date('2026-09-10T12:00:00.000Z')

test('regeneration stays available only while the event is upcoming', () => {
  const upcoming = event('next', '2026-09-11T10:00:00.000Z', '2026-09-11T11:00:00.000Z')
  const past = event('past', '2026-09-09T10:00:00.000Z', '2026-09-09T11:00:00.000Z')
  assert.equal(agendaDraftCanGenerate(record('next', []), [upcoming], now), true)
  assert.equal(agendaDraftCanGenerate(record('past', []), [past], now), false)
  assert.equal(agendaDraftCanGenerate(record('gone', []), [], now), false)
  assert.equal(agendaDraftEvent(record('gone', []), [upcoming]), null)
})

test('the saved list excludes upcoming events so one event has one editor', () => {
  const upcoming = event('next', '2026-09-11T10:00:00.000Z', '2026-09-11T11:00:00.000Z')
  const past = event('past', '2026-09-09T10:00:00.000Z', '2026-09-09T11:00:00.000Z')
  const listed = savedAgendaDraftsOutsideUpcoming([record('next', []), record('past', []), record('gone', [])], [upcoming, past], now)
  assert.deepEqual(listed.map((draft) => draft.sourceId), ['past', 'gone'])
})

test('deleted source Meetings are reported without dropping topics', () => {
  const draft = record('event-1', ['meeting-1', 'meeting-2'])
  assert.deepEqual(missingAgendaSourceIds(draft, new Set(['meeting-1'])), ['meeting-2'])
  assert.deepEqual(missingAgendaSourceIds(draft, new Set(['meeting-1', 'meeting-2'])), [])
})
