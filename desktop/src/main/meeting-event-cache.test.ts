import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { LinkCalendarInput, ParticipantContext } from '../shared/participant-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingEventCache } from '../renderer/hooks/meeting-event-cache.ts'

function event(id: string): CalendarEventSummary {
  return { connectionId: 'work', accountEmail: 'work@example.com', calendarId: 'primary', eventId: id, sourceId: `work:primary:${id}`, title: id, start: '2026-09-14T10:00:00Z', end: '2026-09-14T11:00:00Z', allDay: false, status: 'confirmed' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const link = (id: string, eventSourceId: string): LinkCalendarInput => ({ id, eventSourceId })
const context = (id: string): ParticipantContext => ({ event: event(id), candidates: [] })

test('confirmed mutation publishes after the caller cancels its pending lookup', async () => {
  const cache = new MeetingEventCache()
  const write = deferred<ParticipantContext>()
  const published: Map<string, CalendarEventSummary>[] = []
  const pending = cache.link(link('meeting', 'B'), () => write.promise, value => published.push(value))
  cache.cancel()
  write.resolve(context('B'))
  assert.equal((await pending).event?.eventId, 'B')
  assert.equal(published.length, 1)
  assert.equal(published[0].get('meeting')?.eventId, 'B')
})

test('rapid relinks are written and published in user order for one Meeting', async () => {
  const cache = new MeetingEventCache()
  const first = deferred<ParticipantContext>()
  const started = deferred<void>()
  const calls: string[] = [], published: string[] = []
  const write = (input: LinkCalendarInput) => {
    calls.push(input.eventSourceId)
    if (input.eventSourceId === 'A') { started.resolve(); return first.promise }
    return Promise.resolve(context(input.eventSourceId))
  }
  const publish = (value: Map<string, CalendarEventSummary>) => published.push(value.get('meeting')!.eventId)
  const a = cache.link(link('meeting', 'A'), write, publish)
  const b = cache.link(link('meeting', 'B'), write, publish)
  await started.promise
  assert.deepEqual(calls, ['A'])
  first.resolve(context('A'))
  await Promise.all([a, b])
  assert.deepEqual(calls, ['A', 'B'])
  assert.deepEqual(published, ['A', 'B'])
})

test('a failed link does not publish or block the next requested link', async () => {
  const cache = new MeetingEventCache()
  const published: Map<string, CalendarEventSummary>[] = []
  const failed = cache.link(link('meeting', 'A'), async () => { throw Error('link failed') }, value => published.push(value))
  const next = cache.link(link('meeting', 'B'), async () => context('B'), value => published.push(value))
  await assert.rejects(failed, /link failed/)
  await next
  assert.equal(published.length, 1)
  assert.equal(published[0].get('meeting')?.eventId, 'B')
})

test('independent Meetings do not block each other and unlink removes the map entry', async () => {
  const cache = new MeetingEventCache()
  const slow = deferred<ParticipantContext>()
  const published: Map<string, CalendarEventSummary>[] = []
  const first = cache.link(link('slow', 'A'), () => slow.promise, value => published.push(value))
  await cache.link(link('other', 'B'), async () => context('B'), value => published.push(value))
  assert.equal(published[0].get('other')?.eventId, 'B')
  await cache.link(link('other', ''), async () => ({ candidates: [] }), value => published.push(value))
  assert.equal(published[1].has('other'), false)
  slow.resolve(context('A'))
  await first
})
