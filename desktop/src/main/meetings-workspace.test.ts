import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { MeetingListItem } from '../shared/contracts'
import type { SavedAgendaDraft } from '../shared/agenda-draft'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { agendaDraftKey } from '../shared/agenda-draft.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { currentAgendaEvent, filterWorkspaceRows, workspaceRows } from '../renderer/lib/meetings-workspace.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingEventCache } from '../renderer/hooks/meeting-event-cache.ts'

type Data = Parameters<typeof workspaceRows>[0]
const now = new Date('2026-09-14T09:50:00Z')

function event(id = 'planning', start = '2026-09-14T10:00:00Z'): CalendarEventSummary {
  return { connectionId: 'work', accountEmail: 'work@example.com', calendarId: 'primary', eventId: id, sourceId: `work:primary:${id}`, title: id, start, end: new Date(Date.parse(start) + 3_600_000).toISOString(), allDay: false, status: 'confirmed', attendees: [{ email: 'alex@example.com', name: 'Alex' }] }
}

function meeting(id = 'recorded', startedAt = '2026-09-14T09:00:00Z'): MeetingListItem {
  return { id, title: id, startedAt } as MeetingListItem
}

function draft(source = event()): SavedAgendaDraft {
  return { draftKey: agendaDraftKey(source), sourceId: source.sourceId, title: source.title, accountEmail: source.accountEmail, eventStart: source.start, eventEnd: source.end, items: [{ topic: 'Review keyboard navigation', sourceId: 'recorded', quote: 'Review the flow' }], sources: [], historyIncomplete: false, generatedAt: now.toISOString(), updatedAt: now.toISOString(), model: 'local', reasoningEffort: '', revision: 1, durable: true }
}

function data(overrides: Partial<Data> = {}): Data {
  return { meetings: [meeting()], meetingEvents: new Map(), calendar: { configured: true, connections: [], events: [event()] }, drafts: [], ...overrides }
}

test('Next up is earliest and all later events remain accessible', () => {
  const events = Array.from({ length: 9 }, (_, i) => event(`event-${i}`, `2026-09-${String(15 + i).padStart(2, '0')}T10:00:00Z`)).reverse()
  const rows = workspaceRows(data({ calendar: { configured: true, connections: [], events } }), now)
  assert.equal(rows.upcoming.length, 9)
  assert.equal(rows.upcoming[0].title, 'event-0')
  assert.equal(rows.history[0].kind, 'meeting')
})

test('confirmed links keep one recorded row with its event and Saved Agenda draft', () => {
  const source = event()
  const rows = workspaceRows(data({ meetingEvents: new Map([['recorded', source]]), drafts: [draft(source)] }), now)
  assert.equal(rows.upcoming.length, 0)
  assert.equal(rows.history.length, 1)
  assert.equal(rows.history[0].kind, 'meeting')
  if (rows.history[0].kind !== 'meeting') throw Error('Expected Meeting')
  assert.equal(rows.history[0].event?.sourceId, source.sourceId)
  assert.equal(rows.history[0].draft?.items[0].topic, 'Review keyboard navigation')
})

test('matching time or title never implies a confirmed Calendar link', () => {
  const rows = workspaceRows(data({ meetings: [meeting('planning', event().start)] }), now)
  assert.equal(rows.upcoming.length, 1)
  assert.equal(rows.history.length, 1)
})

test('disconnecting Calendar keeps recordings and standalone Saved Agenda drafts', () => {
  const rows = workspaceRows(data({ calendar: null, drafts: [draft()] }), now)
  assert.equal(rows.upcoming.length, 0)
  assert.deepEqual(new Set(rows.history.map(row => row.kind)), new Set(['meeting', 'draft']))
})

test('passed events disappear from Next up but their saved topics stay in History', () => {
  const source = event('past', '2026-09-11T10:00:00Z')
  const rows = workspaceRows(data({ calendar: { configured: true, connections: [], events: [source] }, drafts: [draft(source)] }), now)
  assert.equal(rows.upcoming.length, 0)
  assert.equal(rows.history.find(row => row.title === 'past')?.kind, 'draft')
})

test('reconnect uses stable account/event identity instead of the old connection id', () => {
  const old = event()
  const fresh = { ...old, sourceId: 'new:primary:planning', connectionId: 'new' }
  const saved = draft(old)
  const source = data({ calendar: { configured: true, connections: [], events: [fresh] }, drafts: [saved] })
  const rows = workspaceRows(source, now)
  assert.equal(rows.upcoming.length, 1)
  assert.equal(rows.history.filter(row => row.kind === 'draft').length, 0)
  assert.equal(currentAgendaEvent({ ...saved, start: saved.eventStart }, source.calendar)?.sourceId, fresh.sourceId)
  source.meetingEvents.set('recorded', old)
  assert.equal(workspaceRows(source, now).upcoming.length, 0)
})

test('a stale link for a deleted Meeting cannot hide its Calendar event', () => {
  const rows = workspaceRows(data({ meetings: [], meetingEvents: new Map([['deleted', event()]]) }), now)
  assert.equal(rows.upcoming.length, 1)
})

test('search covers invitees, saved topics, and existing full-text Meeting matches', () => {
  const rows = workspaceRows(data({ drafts: [draft()] }), now)
  assert.equal(filterWorkspaceRows(rows.upcoming, ' ALEX ', new Set()).length, 1)
  assert.equal(filterWorkspaceRows(rows.upcoming, 'keyboard', new Set()).length, 1)
  assert.equal(filterWorkspaceRows(rows.history, 'transcript hit', new Set(['recorded'])).length, 1)
  assert.equal(filterWorkspaceRows(rows.history, 'no match', new Set()).length, 0)
})

test('Agenda topic search finds the recorded row after confirmed event merging', () => {
  const rows = workspaceRows(data({ meetingEvents: new Map([['recorded', event()]]), drafts: [draft()] }), now)
  assert.equal(filterWorkspaceRows(rows.history, 'keyboard', new Set())[0].key, 'meeting:recorded')
})

test('History includes standalone drafts and Meetings in descending time order', () => {
  const rows = workspaceRows(data({ calendar: null, meetings: [meeting('old', '2026-09-10T09:00:00Z'), meeting('new')], drafts: [draft(event('saved', '2026-09-11T10:00:00Z'))] }), now)
  assert.deepEqual(rows.history.map(row => row.title), ['new', 'saved', 'old'])
})

test('link, relink, and unlink immediately update workspace rows with unchanged counts', () => {
  const cache = new MeetingEventCache()
  const a = event('A'), b = event('B')
  const source = data({ calendar: { configured: true, connections: [], events: [a, b] }, drafts: [draft(a), draft(b)] })
  source.meetingEvents = cache.update('recorded', a)
  assert.deepEqual(workspaceRows(source, now).upcoming.map(row => row.title), ['B'])
  source.meetingEvents = cache.update('recorded', b)
  assert.deepEqual(workspaceRows(source, now).upcoming.map(row => row.title), ['A'])
  source.meetingEvents = cache.update('recorded')
  assert.deepEqual(workspaceRows(source, now).upcoming.map(row => row.title), ['A', 'B'])
  source.calendar = null
  assert.equal(workspaceRows(source, now).history.filter(row => row.kind === 'draft').length, 2)
})

test('a lookup started before a link change cannot overwrite its confirmed result', async () => {
  const cache = new MeetingEventCache()
  let finish!: (value: CalendarEventSummary) => void
  const old = cache.refresh(['recorded'], () => new Promise(resolve => { finish = resolve }))
  const updated = cache.update('recorded', event('new'))
  finish(event('old'))
  assert.equal(await old, null)
  assert.equal(updated.get('recorded')?.title, 'new')
  assert.equal((await cache.refresh(['recorded'], async () => event('new')))?.get('recorded')?.title, 'new')
})

test('cancelled lookups never publish after the hook unmounts', async () => {
  const cache = new MeetingEventCache()
  let finish!: (value: CalendarEventSummary) => void
  const pending = cache.refresh(['recorded'], () => new Promise(resolve => { finish = resolve }))
  cache.cancel()
  finish(event())
  assert.equal(await pending, null)
})
