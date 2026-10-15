import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { calendarEventIsUpcoming, calendarEventKey } from '../../shared/calendar-contract.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { currentEvent, filterWorkspaceRows, workspaceRows } from './meetings-workspace.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingEventCache } from '../hooks/meeting-event-cache.ts'

type Data = Parameters<typeof workspaceRows>[0]
const now = new Date('2026-09-14T09:50:00Z')

function event(id = 'planning', start = '2026-09-14T10:00:00Z'): CalendarEventSummary {
  return { connectionId: 'work', accountEmail: 'work@example.com', calendarId: 'primary', eventId: id, sourceId: `work:primary:${id}`, title: id, start, end: new Date(Date.parse(start) + 3_600_000).toISOString(), allDay: false, status: 'confirmed', attendees: [{ email: 'alex@example.com', name: 'Alex' }] }
}

function meeting(id = 'recorded', startedAt = '2026-09-14T09:00:00Z'): MeetingListItem {
  return { id, title: id, startedAt } as MeetingListItem
}

function data(overrides: Partial<Data> = {}): Data {
  return { meetings: [meeting()], meetingEvents: new Map(), calendar: { configured: true, connections: [], events: [event()] }, ...overrides }
}

test('Next up is earliest and all later events remain accessible', () => {
  const events = Array.from({ length: 9 }, (_, i) => event(`event-${i}`, `2026-09-${String(15 + i).padStart(2, '0')}T10:00:00Z`)).reverse()
  const rows = workspaceRows(data({ calendar: { configured: true, connections: [], events } }), now)
  assert.equal(rows.upcoming.length, 9)
  assert.equal(rows.upcoming[0].title, 'event-0')
  assert.equal(rows.history[0].kind, 'meeting')
})

test('confirmed links keep one recorded row with its event', () => {
  const source = event()
  const rows = workspaceRows(data({ meetingEvents: new Map([['recorded', source]]) }), now)
  assert.equal(rows.upcoming.length, 0)
  assert.equal(rows.history.length, 1)
  assert.equal(rows.history[0].kind, 'meeting')
  if (rows.history[0].kind !== 'meeting') throw Error('Expected Meeting')
  assert.equal(rows.history[0].event?.sourceId, source.sourceId)
})

test('matching time or title never implies a confirmed Calendar link', () => {
  const rows = workspaceRows(data({ meetings: [meeting('planning', event().start)] }), now)
  assert.equal(rows.upcoming.length, 1)
  assert.equal(rows.history.length, 1)
})

test('disconnecting Calendar keeps recordings', () => {
  const rows = workspaceRows(data({ calendar: null }), now)
  assert.equal(rows.upcoming.length, 0)
  assert.deepEqual(rows.history.map(row => row.kind), ['meeting'])
})

test('passed events disappear from Next up', () => {
  const rows = workspaceRows(data({ calendar: { configured: true, connections: [], events: [event('past', '2026-09-11T10:00:00Z')] } }), now)
  assert.equal(rows.upcoming.length, 0)
})

test('reconnect uses stable account/event identity instead of the old connection id', () => {
  const old = event()
  const fresh = { ...old, sourceId: 'new:primary:planning', connectionId: 'new' }
  const source = data({ calendar: { configured: true, connections: [], events: [fresh] } })
  const rows = workspaceRows(source, now)
  assert.equal(rows.upcoming.length, 1)
  const target = { key: calendarEventKey(old), sourceId: old.sourceId, title: old.title, start: old.start, accountEmail: old.accountEmail }
  assert.equal(currentEvent(target, source.calendar)?.sourceId, fresh.sourceId)
  source.meetingEvents.set('recorded', old)
  assert.equal(workspaceRows(source, now).upcoming.length, 0)
})

test('a stale link for a deleted Meeting cannot hide its Calendar event', () => {
  const rows = workspaceRows(data({ meetings: [], meetingEvents: new Map([['deleted', event()]]) }), now)
  assert.equal(rows.upcoming.length, 1)
})

test('search covers invitees and existing full-text Meeting matches', () => {
  const rows = workspaceRows(data(), now)
  assert.equal(filterWorkspaceRows(rows.upcoming, ' ALEX ', new Set()).length, 1)
  assert.equal(filterWorkspaceRows(rows.history, 'transcript hit', new Set(['recorded'])).length, 1)
  assert.equal(filterWorkspaceRows(rows.history, 'no match', new Set()).length, 0)
})

test('invitee search finds the recorded row after confirmed event merging', () => {
  const rows = workspaceRows(data({ meetingEvents: new Map([['recorded', event()]]) }), now)
  assert.equal(filterWorkspaceRows(rows.history, 'alex', new Set())[0].key, 'meeting:recorded')
})

test('History lists Meetings in descending time order', () => {
  const rows = workspaceRows(data({ calendar: null, meetings: [meeting('old', '2026-09-10T09:00:00Z'), meeting('new')] }), now)
  assert.deepEqual(rows.history.map(row => row.title), ['new', 'old'])
})

test('link, relink, and unlink immediately update workspace rows with unchanged counts', () => {
  const cache = new MeetingEventCache()
  const a = event('A'), b = event('B')
  const source = data({ calendar: { configured: true, connections: [], events: [a, b] } })
  source.meetingEvents = cache.update('recorded', a)
  assert.deepEqual(workspaceRows(source, now).upcoming.map(row => row.title), ['B'])
  source.meetingEvents = cache.update('recorded', b)
  assert.deepEqual(workspaceRows(source, now).upcoming.map(row => row.title), ['A'])
  source.meetingEvents = cache.update('recorded')
  assert.deepEqual(workspaceRows(source, now).upcoming.map(row => row.title), ['A', 'B'])
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

test('upcoming visibility supports future dates and local all-day boundaries', () => {
  const timed = event()
  assert.equal(calendarEventIsUpcoming(timed, now), true)
  assert.equal(calendarEventIsUpcoming(timed, new Date(timed.end)), false)
  const day = { ...timed, allDay: true, start: '2026-09-10', end: '2026-09-11' }
  assert.equal(calendarEventIsUpcoming(day, new Date(2026, 8, 10, 23)), true)
  assert.equal(calendarEventIsUpcoming(day, new Date(2026, 8, 11)), false)
})
