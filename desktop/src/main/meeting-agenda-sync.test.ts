import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import * as reconciliation from '../shared/calendar-reconciliation.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import * as agenda from '../shared/meeting-agenda.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GoogleCalendarServiceCore } from './google-calendar-service-core.ts'
import type { CalendarDocument } from './google-calendar-service-core'
import type { CalendarSnapshot, CalendarEventSummary } from '../shared/calendar-contract'
import type { ParticipantContext } from '../shared/participant-contract'

const meeting = { id: 'past', title: 'Past', startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T11:00:00Z', emails: [] as string[] }
const range = { start: Date.parse(meeting.startedAt), end: Date.parse(meeting.endedAt) }
const past: CalendarEventSummary = { sourceId: 'past-event', eventId: 'past-event', status: 'confirmed', connectionId: 'account', accountEmail: 'self@example.com', calendarId: 'primary', title: 'Past', start: meeting.startedAt, end: meeting.endedAt, allDay: false, attendees: [{ email: 'guest@example.com' }] }
const next = { ...past, sourceId: 'next', start: '2099-01-01T10:00:00Z', end: '2099-01-01T11:00:00Z' }

function fixture(service: Record<string, unknown> = {}) {
  const snapshot: CalendarSnapshot = { configured: true, connections: [{ id: 'account', email: past.accountEmail, status: 'ready' }], events: [next] }
  const contexts: Record<string, ParticipantContext> = {}
  const meetings = [{ ...meeting }]
  const calls: string[] = []
  const f = { snapshot, contexts, meetings, calls, pending: [] as string[], sync: async (id: string) => {
    snapshot.connections.find(connection => connection.id === id)!.historyRanges = [range]
    snapshot.events.push(past)
  } }
  const generate = loadSourceModule(new URL('./meeting-agenda.ts', import.meta.url), {
    '../shared/calendar-reconciliation': reconciliation, '../shared/meeting-agenda': agenda,
    './google-calendar-service': { googleCalendarPendingSyncIds: () => f.pending, googleCalendarSnapshot: async () => snapshot, syncGoogleCalendar: async (id: string) => { calls.push(id); await f.sync(id) }, ...service },
    './participant-calendar': { savedMeetingCalendarContexts: async () => contexts },
    './app-protocol': { requestCommand: async (id: string) => id === 'meetings.agendaHistory' ? { meetings } : { items: [] } },
    './summary-runtime': { usingSummaryRuntime: async (work: () => Promise<unknown>) => work() },
  }, { AbortSignal }).generateMeetingAgenda
  return { ...f, generate, state: f }
}

test('legacy missing history warns before sync and generation recovers automatically', async () => {
  const f = fixture()
  assert.equal(reconciliation.agendaReconciliationStatus(reconciliation.reconcileAgendaHistory(f.meetings, {}, f.snapshot)).historyIncomplete, true)
  const draft = await f.generate('next')
  assert.deepEqual(f.calls, ['account'])
  assert.equal(draft.historyIncomplete, false)
  assert.equal(draft.sources[0].calendarProvenance, agenda.INFERRED_CALENDAR_PROVENANCE)
})

test('complete coverage, invalid intervals, confirmed links and opt-out do not sync', async () => {
  for (const mode of ['covered', 'invalid', 'confirmed', 'disabled']) {
    const f = fixture()
    if (mode === 'covered') f.snapshot.connections[0].historyRanges = [range]
    if (mode === 'invalid') f.meetings[0].endedAt = ''
    if (mode === 'confirmed') f.contexts.past = { event: past } as ParticipantContext
    if (mode === 'disabled') f.contexts.past = { inferenceDisabled: true } as ParticipantContext
    const draft = await f.generate('next')
    assert.deepEqual(f.calls, [], mode)
    if (mode === 'invalid') assert.match(draft.historyWarning, /valid recorded time range/)
  }
})

test('partial account failure preserves saved email context and reports account error without retry', async () => {
  const f = fixture()
  f.snapshot.connections.push({ id: 'broken', email: 'broken@example.com', status: 'ready' })
  f.meetings[0].emails = ['guest@example.com']
  const sync = f.state.sync
  f.state.sync = async id => { if (id !== 'broken') return sync(id); f.snapshot.connections[1].error = 'Reconnect required'; throw new Error('Reconnect required') }
  const draft = await f.generate('next')
  assert.deepEqual(f.calls, ['account', 'broken'])
  assert.equal(draft.sources.length, 1)
  assert.equal(draft.historyIncomplete, true)
  assert.match(draft.historyWarning, /broken@example.com: Reconnect required/)
})

test('selected event disappearing during sync is rejected before generation', async () => {
  const f = fixture()
  f.state.sync = async () => { f.snapshot.events = [] }
  await assert.rejects(f.generate('next'), /no longer upcoming/)
  assert.deepEqual(f.calls, ['account'])
})

test('pending failed sync is not retried in the same generation', async () => {
  const f = fixture()
  f.state.pending = ['account']
  f.snapshot.connections[0].error = 'Network unavailable'
  const draft = await f.generate('next')
  assert.deepEqual(f.calls, [])
  assert.match(draft.historyWarning, /Network unavailable/)
})

const tokens = { accessToken: 'token', expiresAt: 0, tokenType: 'Bearer' }

function serviceFixture() {
  const result = deferred<{ tokens: typeof tokens; events: typeof next[]; historyRanges: typeof range[] }>()
  let calls = 0
  let document: CalendarDocument = { version: 1, connections: [{ id: 'account', subject: 'self', email: past.accountEmail, tokens, events: [next] }] }
  const core = new GoogleCalendarServiceCore({ configured: () => true, authorize: async () => { throw new Error('Must not authorize') }, revoke: async () => {}, sync: async () => { calls++; return result.promise } }, { read: async () => structuredClone(document), write: async value => { document = structuredClone(value) } })
  const f = fixture({ googleCalendarPendingSyncIds: () => core.pendingSyncIds(), googleCalendarSnapshot: () => core.snapshot(), syncGoogleCalendar: (id: string) => core.sync(id) })
  return { ...f, core, result, calls: () => calls }
}

test('real service active sync is awaited and coalesced, including failed coverage', async () => {
  for (const fail of [false, true]) {
    const f = serviceFixture()
    const active = f.core.sync('account')
    assert.equal(f.core.sync('account'), active)
    const activeResult = active.catch(() => undefined)
    const generation = f.generate('next')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.calls(), 1)
    if (fail) f.result.reject(new Error('Network unavailable'))
    else f.result.resolve({ tokens, events: [next, past], historyRanges: [range] })
    await activeResult
    const draft = await generation
    assert.equal(f.calls(), 1)
    assert.equal(draft.historyIncomplete, fail)
    if (fail) assert.match(draft.historyWarning, /Network unavailable/)
    else assert.equal(draft.sources.length, 1)
  }
})

test('account changes during preparation use latest confirmed context', async () => {
  const f = fixture()
  f.state.sync = async () => {
    f.snapshot.connections = []
    f.contexts.past = { event: past } as ParticipantContext
  }
  const draft = await f.generate('next')
  assert.equal(draft.historyIncomplete, false)
  assert.equal(draft.sources[0].calendarProvenance, agenda.CONFIRMED_CALENDAR_PROVENANCE)
})

test('sync re-reads opt-out and rejects an event that is no longer upcoming', async () => {
  const f = fixture()
  const sync = f.state.sync
  f.state.sync = async id => { await sync(id); f.contexts.past = { inferenceDisabled: true } as ParticipantContext }
  assert.equal((await f.generate('next')).sources.length, 0)
  const expired = fixture()
  expired.state.sync = async () => { expired.snapshot.events[0] = { ...next, end: meeting.endedAt } }
  await assert.rejects(expired.generate('next'), /no longer upcoming/)
})


test('real service disconnect queued behind active sync invalidates selected event', async () => {
  const f = serviceFixture()
  const active = f.core.sync('account')
  const generation = f.generate('next')
  const disconnected = f.core.disconnect('account')
  f.result.resolve({ tokens, events: [next, past], historyRanges: [range] })
  await Promise.all([active, disconnected])
  await assert.rejects(generation, /no longer upcoming/)
  assert.equal(f.calls(), 1)
})

test('successful sync with residual missing coverage is attempted only once', async () => {
  const f = fixture()
  f.state.sync = async () => {}
  const draft = await f.generate('next')
  assert.deepEqual(f.calls, ['account'])
  assert.equal(draft.historyIncomplete, true)
  assert.match(draft.historyWarning, /coverage is still incomplete/)
})
