import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
// @ts-expect-error explicit extension for Node tests
import { loadSourceModule } from './source-module-test-helper.ts'

function drainFixture() {
  const calls: string[] = []
  const ready = { capabilities: { transcription: { readiness: 'ready' }, diarization: { readiness: 'ready' }, summarization: { readiness: 'ready' } } }
  const module = loadSourceModule(new URL('./drain-coordinator.ts', import.meta.url), {
    './app-protocol': { requestCommand: async (command: string, input: { capability: string }) => {
      calls.push(command === 'processing.drain' ? input.capability : command)
      return command === 'processing.pending' ? { capabilities: ['summarization'] } : { completed: 0, failed: 0 }
    } },
    './speaker-recognition': { recognizePendingSpeakers: async () => { calls.push('recognize') } },
    './managed-runtime': { managedRuntime: { observe: () => () => {}, status: () => ready, using: async (_: unknown, work: () => Promise<unknown>) => work() } },
    './summary-runtime': { usingSummaryRuntime: async (work: (env: object) => Promise<unknown>) => work({}) },
  }, { AbortController, AbortSignal, setInterval: () => 1, clearInterval: () => {}, console })
  return { calls, module }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('startup, retry, and restart recognize before summary claims', { timeout: 2000 }, async () => {
  const f = drainFixture()
  for (let restart = 0; restart < 2; restart++) {
    f.module.startDrainCoordinator(); await settle(); await settle()
    assert.deepEqual(f.calls.slice(-4), ['recognize', 'processing.pending', 'recognize', 'summarization'])
    await f.module.requestPendingDrains(); await settle()
    assert.deepEqual(f.calls.slice(-4), ['recognize', 'processing.pending', 'recognize', 'summarization'])
    await f.module.stopDrainCoordinator()
  }
})

test('automatic UI label exposes its correction path without embedding data', () => {
  const source = readFileSync(new URL('../renderer/routes/speaker-row.tsx', import.meta.url), 'utf8')
  assert.match(source, /identityOrigin === 'automatic'/)
  assert.match(source, /Auto-filled · check label/)
  assert.match(source, /Clear label/)
  assert.doesNotMatch(source, /centroid|embedding/)
})
