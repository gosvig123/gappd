import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { AgendaDraftSession } from '../renderer/hooks/agenda-draft-session.ts'
import type { AgendaPort, AgendaSessionState, AgendaScheduler } from '../renderer/hooks/agenda-draft-session.ts'
import type { AgendaDraftWriteResult, GeneratedAgenda, SavedAgendaDraft } from '../shared/agenda-draft'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function saved(draftKey: string, revision: number, topics: string[]): SavedAgendaDraft {
  return {
    draftKey, sourceId: `source-${draftKey}`, title: 'Agenda', accountEmail: 'self@example.com',
    eventStart: '2026-09-10T10:00:00.000Z', eventEnd: '2026-09-10T11:00:00.000Z',
    items: topics.map((topic, index) => ({ topic, sourceId: `meeting-${index}`, quote: `Evidence ${index}` })),
    sources: [], historyIncomplete: false, generatedAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
    model: 'gpt-5.6-terra', reasoningEffort: 'medium', revision, durable: true,
  }
}

function accepted(draftKey: string, revision: number, topics: string[], durable = true): AgendaDraftWriteResult {
  return { ok: true, draftKey, revision, durable, current: { ...saved(draftKey, revision, topics), durable }, ...(durable ? {} : { error: 'Secure local data could not be written.' }) }
}

function portFixture() {
  const loads = new Map<string, () => Promise<SavedAgendaDraft | null>>()
  const saves: Array<{ input: { draftKey: string; expectedRevision: number; topics: string[] }; pending: ReturnType<typeof deferred<AgendaDraftWriteResult>> }> = []
  const generates: Array<{ input: { sourceId: string; expectedRevision: number }; pending: ReturnType<typeof deferred<GeneratedAgenda>> }> = []
  const port: AgendaPort = {
    load: (draftKey) => loads.get(draftKey)?.() ?? Promise.resolve(null),
    save: (input) => { const pending = deferred<AgendaDraftWriteResult>(); saves.push({ input, pending }); return pending.promise },
    remove: () => Promise.resolve({ removed: true }),
    generate: (input) => { const pending = deferred<GeneratedAgenda>(); generates.push({ input, pending }); return pending.promise },
    now: () => '2026-09-11T12:00:00.000Z',
  }
  return { port, loads, saves, generates }
}

function schedulerFixture() {
  const timers: Array<{ work: () => void; delayMs: number; cancelled: boolean }> = []
  const scheduler: AgendaScheduler = {
    schedule: (work, delayMs) => { const timer = { work, delayMs, cancelled: false }; timers.push(timer); return timer },
    cancel: (handle) => { (handle as { cancelled: boolean }).cancelled = true },
  }
  const run = () => { while (timers.length) { const next = timers.shift() as { work: () => void; cancelled: boolean }; if (!next.cancelled) return next.work() } }
  return { scheduler, timers, run, drain: () => { while (timers.length) run() } }
}

function sessionFixture(draftKey = 'self@example.com:primary:event-1') {
  const { port, loads, saves, generates } = portFixture()
  const { scheduler, timers, run, drain } = schedulerFixture()
  const states: AgendaSessionState[] = []
  const session = new AgendaDraftSession(port, { onState: (state) => states.push(state), scheduler }, { draftKey, sourceId: `source-${draftKey}` })
  return { session, loads, saves, generates, states, timers, run, drain, latest: () => states[states.length - 1] as AgendaSessionState }
}

test('generation stays disabled until the saved draft load succeeds', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  const loading = deferred<SavedAgendaDraft | null>()
  f.loads.set('self@example.com:primary:event-1', () => loading.promise)
  const started = f.session.start()
  assert.equal(f.latest().canGenerate, false)
  await f.session.generate()
  assert.equal(f.generates.length, 0)
  loading.resolve(saved('self@example.com:primary:event-1', 3, ['Topic']))
  await started
  assert.equal(f.latest().canGenerate, true)
  assert.equal(f.latest().draft?.revision, 3)
})

test('a load failure keeps generation disabled and reports the error', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.reject(new Error('damaged')))
  await f.session.start()
  assert.equal(f.latest().canGenerate, false)
  assert.equal(f.latest().loading, false)
  assert.match(f.latest().error, /damaged/)
})

test('an edit during a save keeps the newer topics and saves again', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First', 'Second'])))
  await f.session.start()
  f.session.setTopics(['Edited first', 'Second'])
  f.run()
  assert.equal(f.saves.length, 1)
  f.session.setTopics(['Edited again', 'Second'])
  f.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['Edited first', 'Second']))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.latest().topics[0], 'Edited again')
  assert.equal(f.latest().saveState, 'pending')
  f.run()
  assert.equal(f.saves.length, 2)
  assert.equal(f.saves[1].input.expectedRevision, 2)
  f.saves[1].pending.resolve(accepted('self@example.com:primary:event-1', 3, ['Edited again', 'Second']))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.latest().saveState, 'clean')
})

test('stopping before autosave flushes the pending edit once', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First'])))
  await f.session.start()
  f.session.setTopics(['Edited before navigation'])
  f.session.stop()
  f.drain()
  assert.equal(f.saves.length, 1)
  assert.deepEqual(f.saves[0].input, { draftKey: 'self@example.com:primary:event-1', expectedRevision: 1, topics: ['Edited before navigation'] })
  f.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['Edited before navigation']))
  await new Promise((resolve) => setImmediate(resolve))
  f.drain()
  assert.equal(f.saves.length, 1)
})

test('a non-durable loaded draft stays visibly retryable', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve({ ...saved('self@example.com:primary:event-1', 2, ['Unsaved']), durable: false }))
  await f.session.start()
  assert.equal(f.latest().saveState, 'failed')
  assert.match(f.latest().error, /not on disk yet/)
  assert.equal(f.latest().draft?.durable, false)
})

test('a failed write stays visible as not saved and retry adopts the new revision', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First', 'Second'])))
  await f.session.start()
  f.session.setTopics(['Edited', 'Second'])
  f.run()
  f.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['Edited', 'Second'], false))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.latest().saveState, 'failed')
  assert.equal(f.latest().draft?.durable, false)
  const retry = f.session.retrySave()
  assert.equal(f.saves[1].input.expectedRevision, 2)
  f.saves[1].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['Edited', 'Second']))
  await retry
  assert.equal(f.latest().saveState, 'clean')
  assert.equal(f.latest().draft?.durable, true)
})

test('a conflict cancels queued saves and blocks stop flushes', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First'])))
  await f.session.start()
  f.session.setTopics(['First edit'])
  f.run()
  f.session.setTopics(['Second edit'])
  f.saves[0].pending.resolve({ ok: false, reason: 'conflict', draftKey: 'self@example.com:primary:event-1', revision: 4, durable: true, current: saved('self@example.com:primary:event-1', 4, ['Stored']), error: 'changed' })
  await new Promise((resolve) => setImmediate(resolve))
  f.drain()
  f.session.stop()
  assert.equal(f.saves.length, 1)
  assert.equal(f.latest().saveState, 'conflict')
  assert.equal(f.latest().topics[0], 'Second edit')
})

test('stopping behind a save drains the latest successful edit', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First'])))
  await f.session.start()
  f.session.setTopics(['First edit'])
  f.run()
  f.session.setTopics(['Second edit'])
  f.session.stop()
  f.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['First edit']))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.saves[1].input, { draftKey: 'self@example.com:primary:event-1', expectedRevision: 2, topics: ['Second edit'] })
  f.saves[1].pending.resolve(accepted('self@example.com:primary:event-1', 3, ['Second edit']))
  await new Promise((resolve) => setImmediate(resolve))
  f.drain()
  assert.equal(f.saves.length, 2)
})

test('stopping behind a failed write retries the latest edit', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First'])))
  await f.session.start()
  f.session.setTopics(['First edit'])
  f.run()
  f.session.setTopics(['Second edit'])
  f.session.stop()
  f.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['First edit'], false))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(f.saves[1].input, { draftKey: 'self@example.com:primary:event-1', expectedRevision: 2, topics: ['Second edit'] })
  f.saves[1].pending.resolve(accepted('self@example.com:primary:event-1', 3, ['Second edit']))
  await new Promise((resolve) => setImmediate(resolve))
  f.drain()
  assert.equal(f.saves.length, 2)
})

test('a conflict is reported with the stored version and keeps local topics', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First', 'Second'])))
  await f.session.start()
  f.session.setTopics(['Mine', 'Second'])
  f.run()
  const conflict: AgendaDraftWriteResult = { ok: false, reason: 'conflict', draftKey: 'self@example.com:primary:event-1', revision: 4, durable: true, error: 'This saved agenda changed since it was loaded.', current: saved('self@example.com:primary:event-1', 4, ['Theirs', 'Second']), conflict: { revision: 4, updatedAt: '2026-09-11T10:00:00.000Z', topics: ['Theirs', 'Second'] } }
  f.saves[0].pending.resolve(conflict)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.latest().saveState, 'conflict')
  assert.equal(f.latest().draft?.revision, 4)
  assert.equal(f.latest().topics[0], 'Mine')
  f.session.setTopics(['Mine changed'])
  f.drain()
  await f.session.generate()
  assert.equal(f.saves.length, 1)
  assert.equal(f.generates.length, 0)
  assert.equal(f.latest().topics[0], 'Mine')
  await f.session.reload()
  assert.equal(f.latest().topics[0], 'First')
  assert.equal(f.latest().saveState, 'clean')
})

test('swapping draft keys stops the previous session from applying late responses', { timeout: 1000 }, async () => {
  const first = sessionFixture('self@example.com:primary:event-1')
  first.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 1, ['First', 'Second'])))
  await first.session.start()
  first.session.setTopics(['Edited', 'Second'])
  first.run()
  const before = first.states.length
  first.session.stop()
  const second = sessionFixture('self@example.com:primary:event-2')
  second.loads.set('self@example.com:primary:event-2', () => Promise.resolve(saved('self@example.com:primary:event-2', 7, ['Other'])))
  await second.session.start()
  first.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['Edited', 'Second']))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(first.states.length, before)
  assert.equal(first.latest().draft?.revision, 1)
  assert.equal(second.latest().draft?.revision, 7)
  assert.equal(second.latest().topics[0], 'Other')
})

test('a late save cannot replace a reloaded draft', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  let loads = 0
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', ++loads === 1 ? 1 : 4, [loads === 1 ? 'First' : 'Current'])))
  await f.session.start()
  f.session.setTopics(['Edited'])
  f.run()
  await f.session.reload()
  f.saves[0].pending.resolve(accepted('self@example.com:primary:event-1', 2, ['Edited']))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.latest().draft?.revision, 4)
  assert.equal(f.latest().topics[0], 'Current')
})

test('a late load cannot replace a newer reload', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  const first = deferred<SavedAgendaDraft | null>()
  const second = deferred<SavedAgendaDraft | null>()
  let calls = 0
  f.loads.set('self@example.com:primary:event-1', () => ++calls === 1 ? first.promise : second.promise)
  const started = f.session.start()
  const reloaded = f.session.reload()
  second.resolve(saved('self@example.com:primary:event-1', 3, ['Current']))
  await reloaded
  first.resolve(saved('self@example.com:primary:event-1', 1, ['Stale']))
  await started
  assert.equal(f.latest().draft?.revision, 3)
  assert.equal(f.latest().topics[0], 'Current')
})

test('a late generation cannot replace a reloaded draft', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 5, ['Saved'])))
  await f.session.start()
  const generated = f.session.generate()
  await f.session.reload()
  f.generates[0].pending.resolve({
    sourceId: 'source-self@example.com:primary:event-1', draftKey: 'self@example.com:primary:event-1',
    draft: { items: [{ topic: 'Stale generation', sourceId: 'meeting-0', quote: 'Evidence 0' }], sources: [] },
    saved: true, durable: true, conflict: false, revision: 6, generatedAt: '2026-09-11T12:00:00.000Z', model: 'gpt-5.6-terra', reasoningEffort: 'medium',
  })
  await generated
  assert.equal(f.latest().draft?.revision, 5)
  assert.equal(f.latest().topics[0], 'Saved')
  assert.equal(f.latest().generating, false)
})

test('generation sends the loaded revision and a conflict keeps the saved draft', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(saved('self@example.com:primary:event-1', 5, ['First', 'Second'])))
  await f.session.start()
  const pending = f.session.generate()
  assert.equal(f.generates[0].input.expectedRevision, 5)
  assert.equal(f.latest().generating, true)
  f.generates[0].pending.resolve({
    sourceId: 'source-self@example.com:primary:event-1', draftKey: 'self@example.com:primary:event-1', draft: null, saved: false,
    durable: false, conflict: true, revision: 6, generatedAt: '2026-09-11T12:00:00.000Z', model: '', reasoningEffort: '', error: 'The saved agenda changed. Reload the saved version before generating again.',
  })
  await pending
  assert.equal(f.latest().saveState, 'conflict')
  assert.equal(f.latest().draft?.revision, 5)
  assert.equal(f.latest().topics[0], 'First')
})

test('a generated draft is adopted with its revision and durability', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(null))
  await f.session.start()
  assert.equal(f.latest().canGenerate, true)
  const pending = f.session.generate()
  f.generates[0].pending.resolve({
    sourceId: 'source-self@example.com:primary:event-1', draftKey: 'self@example.com:primary:event-1',
    draft: { items: [{ topic: 'Generated topic', sourceId: 'meeting-0', quote: 'Evidence 0' }], sources: [] },
    saved: true, durable: true, conflict: false, revision: 1, generatedAt: '2026-09-11T12:00:00.000Z', model: 'gpt-5.6-terra', reasoningEffort: 'medium',
  })
  await pending
  assert.equal(f.latest().draft?.revision, 1)
  assert.equal(f.latest().topics[0], 'Generated topic')
  assert.equal(f.latest().saveState, 'clean')
  assert.equal(f.latest().generating, false)
})

test('a generation that could not be written stays visible as not saved', { timeout: 1000 }, async () => {
  const f = sessionFixture()
  f.loads.set('self@example.com:primary:event-1', () => Promise.resolve(null))
  await f.session.start()
  const pending = f.session.generate()
  f.generates[0].pending.resolve({
    sourceId: 'source-self@example.com:primary:event-1', draftKey: 'self@example.com:primary:event-1',
    draft: { items: [{ topic: 'Generated topic', sourceId: 'meeting-0', quote: 'Evidence 0' }], sources: [] },
    saved: false, durable: false, conflict: false, revision: 1, generatedAt: '2026-09-11T12:00:00.000Z', model: 'gpt-5.6-terra', reasoningEffort: 'medium',
    error: 'Secure local data could not be written.',
  })
  await pending
  assert.equal(f.latest().saveState, 'failed')
  assert.match(f.latest().error, /could not be written/)
})
