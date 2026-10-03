import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'

function runtimeFixture(provider: string, ready = true) {
  const calls = { config: 0, status: 0, using: 0 }
  const acquisition = deferred<void>()
  const runtime = loadSourceModule(new URL('./summary-runtime.ts', import.meta.url), {
    './app-protocol': { requestCommand: async (id: string) => { assert.equal(id, 'config.show'); calls.config++; return { ai: { provider } } } },
    './managed-runtime': { managedRuntime: {
      status: () => { calls.status++; return { activity: ready ? 'idle' : 'in_use', operation: ready ? 'ready' : 'error' } },
      using: async (_capabilities: string[], work: () => Promise<unknown>) => { calls.using++; await acquisition.promise; return work() },
    } },
  })
  return { calls, acquisition, using: runtime.usingSummaryRuntime }
}

test('summary runtime reads config once and Codex bypasses the local readiness guard', async () => {
  const f = runtimeFixture('codex_exec', false)
  assert.equal(await f.using(async () => 'draft', true), 'draft')
  assert.deepEqual(f.calls, { config: 1, status: 0, using: 0 })
})

test('live draft local readiness rejects unavailable runtime before acquisition', async () => {
  const f = runtimeFixture('llamacpp', false)
  await assert.rejects(f.using(async () => assert.fail('must not extract'), true), /busy or unavailable/)
  assert.deepEqual(f.calls, { config: 1, status: 1, using: 0 })
})

test('ready local runtime acquires once; final processing does not opt into readiness rejection', async () => {
  const f = runtimeFixture('llamacpp')
  f.acquisition.resolve()
  assert.equal(await f.using(async () => 'draft', true), 'draft')
  assert.deepEqual(f.calls, { config: 1, status: 1, using: 1 })
  const final = runtimeFixture('llamacpp', false)
  final.acquisition.resolve()
  assert.equal(await final.using(async () => 'summary'), 'summary')
  assert.deepEqual(final.calls, { config: 1, status: 0, using: 1 })
})

test('cancellation during local acquisition prevents the generation callback from launching work', async () => {
  const f = runtimeFixture('llamacpp')
  const controller = new AbortController()
  const pending = f.using(async () => { controller.signal.throwIfAborted(); assert.fail('must not extract') }, true)
  await Promise.resolve()
  controller.abort()
  f.acquisition.resolve()
  await assert.rejects(pending, /abort/i)
  assert.deepEqual(f.calls, { config: 1, status: 1, using: 1 })
})
