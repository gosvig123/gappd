import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { createLiveActionsRequests } from './live-actions-request.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'

function liveActionsFixture() {
  let recording = true, onChange = () => {}, launched = 0, paused = 0
  const acquired = deferred<void>(), cleanup = deferred<void>(), extracted = deferred<unknown>()
  const module = loadSourceModule(new URL('./live-actions.ts', import.meta.url), {
    '../shared/meeting-recording-workflow': { RECORDING_STATUS_RECORDING: 'recording' },
    './live-actions-request': { createLiveActionsRequests },
    './state': { getRecordingState: () => ({ status: recording ? 'recording' : 'stopping', meetingId: 'meeting' }), onRecordingStateChange: (fn: () => void) => { onChange = fn } },
    './drain-coordinator': { pauseDrains: async (reason: string) => { assert.equal(reason, 'live-actions'); paused++ }, resumeDrains: () => { paused-- } },
    './app-protocol': { requestCommand: async (id: string) => {
      if (id === 'meetings.show') return { meeting: { segments: [{ text: 'Synthetic transcript' }] } }
      assert.equal(id, 'meetings.generateLiveActions'); launched++; return extracted.promise
    } },
    './summary-runtime': { usingSummaryRuntime: async (work: (env: object) => Promise<unknown>, requireReady: boolean) => {
      assert.equal(requireReady, true)
      await acquired.promise
      try { return await work({}) } finally { await cleanup.promise }
    } },
  })
  return { module, acquired, cleanup, extracted, stop: () => { recording = false; onChange() }, paused: () => paused, launched: () => launched }
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve() }

test('stop during runtime acquisition prevents command launch and keeps draft drain pause through cleanup', async () => {
  const f = liveActionsFixture()
  const pending = f.module.generateLiveActions('meeting')
  await flush()
  f.stop(); f.acquired.resolve()
  await flush()
  assert.equal(f.launched(), 0)
  assert.equal(f.paused(), 1)
  assert.equal(f.module.liveActionsGenerating('meeting'), true)
  f.cleanup.resolve()
  await assert.rejects(pending, /abort/i)
  assert.equal(f.paused(), 0)
  assert.equal(f.module.liveActionsGenerating('meeting'), false)
})

test('stop during extraction rejects late result only after runtime cleanup releases the draft drain pause', async () => {
  const f = liveActionsFixture()
  f.acquired.resolve()
  const pending = f.module.generateLiveActions('meeting')
  await flush()
  assert.equal(f.launched(), 1)
  f.stop(); f.extracted.resolve({ draft: { snapshotId: 'late' } })
  await flush()
  assert.equal(f.paused(), 1)
  f.cleanup.resolve()
  await assert.rejects(pending, /abort/i)
  assert.equal(f.paused(), 0)
})
