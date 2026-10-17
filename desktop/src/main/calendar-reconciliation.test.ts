import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarEventSummary, CalendarSnapshot } from '../shared/calendar-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { reconcileMeetingCalendar, reconcileAgendaHistory, agendaReconciliationStatus } from '../shared/calendar-reconciliation.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { matchAgendaHistory } from '../shared/meeting-agenda.ts'

const meeting = { id: 'past', title: 'Recorded before connection', startedAt: '2025-01-01T12:00:00Z', endedAt: '2025-01-01T13:00:00Z', emails: [] }
const event: CalendarEventSummary = { connectionId: 'work', accountEmail: 'me@example.com', calendarId: 'primary', sourceId: 'work:primary:past', eventId: 'past', title: 'Past Calendar', start: meeting.startedAt, end: meeting.endedAt, allDay: false, status: 'confirmed', attendees: [{ email: ' ME@example.com ' }, { email: ' Partner@Example.com ' }] }
const snapshot: CalendarSnapshot = { configured: true, connections: [{ id: 'work', email: event.accountEmail, status: 'ready', historyRanges: [{ start: Date.parse(meeting.startedAt), end: Date.parse(meeting.endedAt) }] }], events: [event] }

test('Meeting recorded before connection gains exact invitee evidence without identity mutation', () => {
  const before = structuredClone({ meeting, snapshot })
  assert.deepEqual(reconcileAgendaHistory([meeting], {}, { ...snapshot, connections: [], events: [] })[0].emails, [])
  const history = reconcileAgendaHistory([meeting], {}, snapshot)
  assert.deepEqual(history[0].emails, ['partner@example.com'])
  assert.equal(history[0].calendarProvenance, 'inferred')
  const upcoming = { ...event, start: '2026-09-20T12:00:00Z', end: '2026-09-20T13:00:00Z' }
  const sources = matchAgendaHistory(upcoming, history, [], Date.parse('2026-09-19'))
  assert.equal(sources[0].calendarProvenance, 'inferred')
  assert.equal(sources[0].calendarTitle, event.title)
  assert.deepEqual({ meeting, snapshot }, before)
})

test('requires meaningful actual overlap, not margin or touching boundaries', () => {
  for (const start of ['2025-01-01T13:00:00Z', '2025-01-01T13:10:00Z', '2025-01-01T12:31:00Z']) {
    assert.deepEqual(reconcileMeetingCalendar(meeting, undefined, [{ ...event, start, end: '2025-01-01T14:00:00Z' }], []), {})
  }
  assert.equal(reconcileMeetingCalendar(meeting, undefined, [{ ...event, start: '2025-01-01T12:30:00Z' }], []).calendarProvenance, 'inferred')
  for (const endedAt of [undefined, meeting.startedAt, 'invalid']) assert.deepEqual(reconcileMeetingCalendar({ ...meeting, endedAt }, undefined, [event], []), {})
})

test('any additional eligible overlap is ambiguous, including a small overlap', () => {
  const second = { ...event, sourceId: 'other', start: '2025-01-01T12:59:00Z' }
  assert.deepEqual(reconcileMeetingCalendar(meeting, undefined, [event, second], []), { calendarAmbiguous: true })
})

test('excludes all-day, cancelled, declined and self-only events, including missing self flag', () => {
  const excluded = [{ ...event, allDay: true }, { ...event, status: 'cancelled' }, { ...event, attendees: [{ email: event.accountEmail }] }, { ...event, attendees: [{ email: ' ME@example.com ', responseStatus: 'declined' }, { email: 'partner@example.com' }] }, { ...event, attendees: [{ email: 'partner@example.com', responseStatus: 'declined' }] }]
  for (const candidate of excluded) assert.deepEqual(reconcileMeetingCalendar(meeting, undefined, [candidate], []), {})
})

test('explicit selection wins and explicit unlink prevents automatic matching', () => {
  const selected = { ...event, sourceId: 'selected', start: '2024-01-01T12:00:00Z' }
  assert.deepEqual(reconcileMeetingCalendar(meeting, { event: selected, candidates: [] }, [event], []), { event: selected, calendarProvenance: 'confirmed' })
  assert.deepEqual(reconcileMeetingCalendar(meeting, { candidates: [event], inferenceDisabled: true }, [event], []), {})
})

test('disconnect, account mismatch and incomplete sync disable inference but preserve explicit snapshots', () => {
  for (const connections of [[], [{ ...snapshot.connections[0], id: 'different' }], [{ ...snapshot.connections[0], error: 'History incomplete' }]]) {
    const state = { ...snapshot, connections }
    assert.deepEqual(reconcileAgendaHistory([meeting], {}, state)[0].emails, [])
    assert.equal(reconcileAgendaHistory([meeting], { past: { event, candidates: [] } }, state)[0].calendarProvenance, 'confirmed')
  }
})

test('unknown legacy coverage and newly imported past Meetings require another sync', () => {
  const legacy = { ...snapshot, connections: [{ ...snapshot.connections[0], historyRanges: undefined }] }
  assert.equal(reconcileAgendaHistory([meeting], {}, legacy)[0].calendarReconciliationUnavailable, true)
  const imported = { ...meeting, startedAt: '2025-01-01T11:55:00Z' }
  const pending = reconcileAgendaHistory([imported], {}, snapshot)[0]
  assert.equal(pending.calendarReconciliationUnavailable, true)
  assert.deepEqual(pending.emails, [])
  const synced = { ...snapshot, connections: [{ ...snapshot.connections[0], historyRanges: [{ start: Date.parse(imported.startedAt), end: Date.parse(imported.endedAt) }] }] }
  assert.equal(reconcileAgendaHistory([imported], {}, synced)[0].calendarProvenance, 'inferred')
})

test('another connected account must also have complete healthy coverage before inference', () => {
  const other = { ...snapshot.connections[0], id: 'home', email: 'home@example.com' }
  for (const connection of [{ ...other, error: 'offline' }, { ...other, historyRanges: undefined }]) {
    const state = { ...snapshot, connections: [...snapshot.connections, connection] }
    const result = reconcileAgendaHistory([meeting], {}, state)[0]
    assert.equal(result.calendarReconciliationUnavailable, true)
    assert.deepEqual(result.emails, [])
    assert.equal(reconcileAgendaHistory([meeting], { past: { event, candidates: [] } }, state)[0].calendarProvenance, 'confirmed')
  }
  assert.equal(reconcileAgendaHistory([meeting], {}, { ...snapshot, connections: [...snapshot.connections, other] })[0].calendarProvenance, 'inferred')
})

test('adjacent successful ranges cover long Meetings but gaps do not', () => {
  const start = Date.parse(meeting.startedAt), end = Date.parse(meeting.endedAt), middle = (start + end) / 2
  const state = { ...snapshot, connections: [{ ...snapshot.connections[0], historyRanges: [{ start, end: middle }, { start: middle, end }] }] }
  assert.equal(reconcileAgendaHistory([meeting], {}, state)[0].calendarProvenance, 'inferred')
  state.connections[0].historyRanges[1].start++
  assert.equal(reconcileAgendaHistory([meeting], {}, state)[0].calendarReconciliationUnavailable, true)
})

test('ambiguity propagates separately from no match into the agenda response', () => {
  const state = { ...snapshot, events: [event, { ...event, sourceId: 'second' }] }
  const history = reconcileAgendaHistory([meeting], {}, state)
  assert.deepEqual(history[0].emails, [])
  assert.deepEqual(agendaReconciliationStatus(history), { historyIncomplete: false, ambiguousMeetings: [{ id: meeting.id, title: meeting.title, startedAt: meeting.startedAt }] })
  assert.deepEqual(agendaReconciliationStatus(reconcileAgendaHistory([meeting], {}, { ...snapshot, events: [] })).ambiguousMeetings, [])
  assert.deepEqual(agendaReconciliationStatus(reconcileAgendaHistory([meeting], { past: { event, candidates: [] } }, state)).ambiguousMeetings, [])
})
