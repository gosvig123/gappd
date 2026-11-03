import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
// @ts-expect-error explicit extension for Node tests
import { loadSourceModule } from './source-module-test-helper.ts'

function drainFixture() {
  const calls: string[] = []
  const state = { recognized: true, recognition: Promise.resolve(), drain: Promise.resolve(), pending: ['summarization'], failDiarization: false }
  const ready = { capabilities: { transcription: { readiness: 'ready' }, diarization: { readiness: 'ready' }, summarization: { readiness: 'ready' } } }
  const module = loadSourceModule(new URL('./drain-coordinator.ts', import.meta.url), {
    './app-protocol': { requestCommand: async (command: string, input: { capability: string }) => {
      calls.push(command === 'processing.drain' ? input.capability : command)
      if (command === 'processing.drain') await state.drain
      if (command === 'processing.drain' && input.capability === 'diarization' && state.failDiarization) throw new Error('claim failed')
      return command === 'processing.pending' ? { capabilities: state.pending } : { completed: 0, failed: 0 }
    } },
    './speaker-recognition': { recognizePendingSpeakers: async () => { calls.push('recognize'); await state.recognition; return state.recognized } },
    './managed-runtime/runtime': { managedRuntime: { observe: () => () => {}, status: () => ready, using: async (_: unknown, work: () => Promise<unknown>) => work() } },
    './summary-runtime': { usingSummaryRuntime: async (work: (env: object) => Promise<unknown>) => work({}) },
  }, { AbortController, AbortSignal, setInterval: () => 1, clearInterval: () => {}, console })
  return { calls, state, module }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('startup recognizes once before summary claims; the retry check does not repeat a complete pass', { timeout: 2000 }, async () => {
  const f = drainFixture()
  for (let restart = 0; restart < 2; restart++) {
    f.calls.length = 0
    f.module.startDrainCoordinator(); await settle(); await settle()
    assert.deepEqual(f.calls, ['recognize', 'processing.pending', 'summarization'])
    f.state.pending = []
    await f.module.requestPendingDrains(); await settle()
    assert.deepEqual(f.calls.slice(3), ['processing.pending'])
    f.state.pending = ['summarization']
    await f.module.stopDrainCoordinator()
  }
})

test('notes work recognizes first, so a Meeting skipped while claimed gets names before notes', { timeout: 2000 }, async () => {
  const f = drainFixture()
  f.module.startDrainCoordinator(); await settle(); await settle()
  f.calls.length = 0
  await f.module.requestPendingDrains(); await settle(); await settle()
  assert.deepEqual(f.calls, ['processing.pending', 'recognize', 'summarization'])
  await f.module.stopDrainCoordinator()
})

test('a running pass is not queued again by the retry check', { timeout: 2000 }, async () => {
  const f = drainFixture()
  let finish = () => {}
  f.state.recognition = new Promise<void>(resolve => { finish = resolve })
  f.state.pending = []
  f.module.startDrainCoordinator(); await settle()
  await f.module.requestPendingDrains(); await settle()
  finish(); for (let step = 0; step < 4; step++) await settle()
  assert.deepEqual(f.calls.filter(call => call === 'recognize'), ['recognize'])
  await f.module.stopDrainCoordinator()
})

test('a running retry after a failed pass is not queued again', { timeout: 2000 }, async () => {
  const f = drainFixture()
  f.state.pending = []
  f.state.recognized = false
  f.module.startDrainCoordinator(); await settle(); await settle()
  let finish = () => {}
  f.state.recognition = new Promise<void>(resolve => { finish = resolve })
  f.state.recognized = true
  f.calls.length = 0
  await f.module.requestPendingDrains(); await settle()
  await f.module.requestPendingDrains(); await settle()
  finish(); for (let step = 0; step < 4; step++) await settle()
  assert.deepEqual(f.calls.filter(call => call === 'recognize'), ['recognize'])
  await f.module.stopDrainCoordinator()
})

test('a failed speaker detection drain still asks for recognition', { timeout: 2000 }, async () => {
  const f = drainFixture()
  f.state.pending = []
  f.module.startDrainCoordinator(); await settle(); await settle()
  f.state.pending = ['diarization']
  f.state.failDiarization = true
  f.calls.length = 0
  await f.module.requestPendingDrains(); for (let step = 0; step < 4; step++) await settle()
  assert.deepEqual(f.calls, ['processing.pending', 'diarization', 'recognize'])
  await f.module.stopDrainCoordinator()
})

test('a pass with a failed Meeting repeats on the retry check', { timeout: 2000 }, async () => {
  const f = drainFixture()
  f.state.recognized = false
  f.module.startDrainCoordinator(); await settle(); await settle()
  f.state.recognized = true
  f.state.pending = []
  f.calls.length = 0
  await f.module.requestPendingDrains(); await settle(); await settle()
  assert.deepEqual(f.calls, ['recognize', 'processing.pending'])
  await f.module.requestPendingDrains(); await settle()
  assert.deepEqual(f.calls.slice(2), ['processing.pending'])
  await f.module.stopDrainCoordinator()
})

test('an edit recognizes speakers only after the running drain ends', { timeout: 2000 }, async () => {
  const f = drainFixture()
  f.module.startDrainCoordinator(); await settle(); await settle()
  let finish = () => {}
  f.state.drain = new Promise<void>(resolve => { finish = resolve })
  f.calls.length = 0
  await f.module.requestPendingDrains(); await settle()
  f.module.requestDrains(); await settle()
  assert.deepEqual(f.calls, ['processing.pending', 'recognize', 'summarization'])
  finish(); for (let step = 0; step < 4; step++) await settle()
  assert.deepEqual(f.calls.slice(3), ['transcription', 'diarization', 'recognize', 'summarization'])
  await f.module.stopDrainCoordinator()
})

test('automatic UI label exposes its correction path without embedding data', () => {
  const source = readFileSync(new URL('../renderer/components/meeting/speaker-row.tsx', import.meta.url), 'utf8')
  assert.match(source, /identityOrigin === 'automatic'/)
  assert.match(source, /Auto-filled · check label/)
  assert.match(source, /Clear label/)
  assert.doesNotMatch(source, /centroid|embedding/)
})
