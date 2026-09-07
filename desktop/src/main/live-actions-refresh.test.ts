import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'

type DraftMeeting = { id: string; liveActionDraft: { snapshotId: string } }

function rendererFixture() {
  let generation = deferred<unknown>()
  let stored = { id: 'meeting', liveActionDraft: { snapshotId: 'old' } }
  let show = async (_id: string) => stored
  const module = loadSourceModule(new URL('../renderer/hooks/live-actions-generation.ts', import.meta.url), {}, {
    window: { gappd: { meetings: { show: (id: string) => show(id), generateLiveActions: () => generation.promise } } },
  })
  return { readMeeting: module.readMeeting, generateLiveActions: module.generateLiveActions, generation,
    retry: () => { generation = deferred<unknown>(); generation.resolve({ draft: { snapshotId: 'retry' } }) }, replace: () => { stored = { id: 'meeting', liveActionDraft: { snapshotId: 'new' } } },
    delay: (promise: Promise<typeof stored>) => { show = () => promise }, restore: () => { show = async () => stored } }
}

test('delayed Meeting read cannot replace the immediate generated draft', async () => {
  const f = rendererFixture(), old = deferred<DraftMeeting>()
  f.delay(old.promise)
  const reading = f.readMeeting('meeting')
  const generating = f.generateLiveActions('meeting')
  f.replace(); f.restore(); f.generation.resolve({ draft: { snapshotId: 'new' } })
  assert.equal((await generating).draft.snapshotId, 'new')
  old.resolve({ id: 'meeting', liveActionDraft: { snapshotId: 'old' } })
  assert.equal((await reading).liveActionDraft.snapshotId, 'new')
})

test('a new reader after navigation/remount recovers an in-flight generation without its panel callback', async () => {
  const f = rendererFixture(), old = deferred<DraftMeeting>()
  const generating = f.generateLiveActions('meeting')
  f.delay(old.promise)
  const remountedRead = f.readMeeting('meeting')
  f.replace(); f.restore(); f.generation.resolve({ draft: { snapshotId: 'new' } })
  await generating
  old.resolve({ id: 'meeting', liveActionDraft: { snapshotId: 'old' } })
  assert.equal((await remountedRead).liveActionDraft.snapshotId, 'new')
})

test('existing Meeting reads observe external stored draft replacement without local generation', async () => {
  const f = rendererFixture()
  assert.equal((await f.readMeeting('meeting')).liveActionDraft.snapshotId, 'old')
  f.replace()
  assert.equal((await f.readMeeting('meeting')).liveActionDraft.snapshotId, 'new')
})

test('failed generation invalidates delayed reads and permits retry', async () => {
  const f = rendererFixture(), old = deferred<DraftMeeting>()
  f.delay(old.promise)
  const reading = f.readMeeting('meeting'), generation = f.generateLiveActions('meeting')
  f.generation.reject(new Error('provider failed'))
  await assert.rejects(generation, /provider failed/)
  f.restore(); old.resolve({ id: 'meeting', liveActionDraft: { snapshotId: 'stale' } })
  assert.equal((await reading).liveActionDraft.snapshotId, 'old')
  f.retry()
  assert.equal((await f.generateLiveActions('meeting')).draft.snapshotId, 'retry')
})

test('desktop Meeting read retries across generation completion after renderer reload', async () => {
  let revision = 1, calls = 0
  const old = deferred<unknown>()
  const module = loadSourceModule(new URL('./meetings.ts', import.meta.url), {
    './live-actions': { liveActionsRevision: () => revision, liveActionsGenerating: () => revision === 1 },
    './app-protocol': { requestCommand: () => ++calls === 1 ? old.promise : Promise.resolve({ meeting: { id: 'meeting', liveActionDraft: { snapshotId: 'new' } } }) },
    './drain-coordinator': {}, './participant-calendar': {},
  })
  const reading = module.showMeeting('meeting')
  revision++
  old.resolve({ meeting: { id: 'meeting', liveActionDraft: { snapshotId: 'old' } } })
  const meeting = await reading
  assert.equal(meeting.liveActionDraft.snapshotId, 'new')
  assert.equal(meeting.liveActionsGenerating, false)
  assert.equal(calls, 2)
})

test('desktop Meeting read decorates local generation activity on remount', async () => {
  const module = loadSourceModule(new URL('./meetings.ts', import.meta.url), {
    './live-actions': { liveActionsRevision: () => 1, liveActionsGenerating: (id: string) => id === 'meeting' },
    './app-protocol': { requestCommand: async () => ({ meeting: { id: 'meeting', liveActionDraft: { snapshotId: 'previous' } } }) },
    './drain-coordinator': {}, './participant-calendar': {},
  })
  const meeting = await module.showMeeting('meeting')
  assert.equal(meeting.liveActionDraft.snapshotId, 'previous')
  assert.equal(meeting.liveActionsGenerating, true)
})
