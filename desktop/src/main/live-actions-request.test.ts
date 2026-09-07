import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { createLiveActionsRequests } from './live-actions-request.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('live actions reject non-recording meetings before work', async () => {
  const requests = createLiveActionsRequests({ recording: () => false, generate: async () => assert.fail('must not generate') })
  await assert.rejects(requests.generate('meeting'), /recording meeting/)
})

test('live actions reject duplicate clicks and allow repeat generation', async () => {
  const result = deferred<string>()
  let calls = 0
  const requests = createLiveActionsRequests({ recording: () => true, generate: () => { calls++; return result.promise } })
  const first = requests.generate('meeting')
  assert.equal(requests.generating('meeting'), true)
  await assert.rejects(requests.generate('meeting'), /already generating/)
  assert.equal(calls, 1)
  result.resolve('draft')
  assert.equal(await first, 'draft')
  assert.equal(requests.generating('meeting'), false)
  assert.equal(await requests.generate('meeting'), 'draft')
  assert.equal(calls, 2)
})

test('live actions clear failed request for retry', async () => {
  let fail = true
  const requests = createLiveActionsRequests({ recording: () => true, generate: async () => {
    if (fail) throw new Error('provider unavailable')
    return 'retry draft'
  } })
  await assert.rejects(requests.generate('meeting'), /provider unavailable/)
  assert.equal(requests.generating('meeting'), false)
  fail = false
  assert.equal(await requests.generate('meeting'), 'retry draft')
})

test('live actions abort on stop and ignore results from uncooperative work', async () => {
  let recording = true
  const result = deferred<string>()
  let signal: AbortSignal | undefined
  const requests = createLiveActionsRequests({ recording: () => recording, generate: (_id, next) => { signal = next; return result.promise } })
  const pending = requests.generate('meeting')
  await Promise.resolve()
  recording = false
  requests.cancelStale()
  assert.equal(signal?.aborted, true)
  result.resolve('stale draft')
  await assert.rejects(pending, /abort/i)
  assert.equal(requests.generating('meeting'), false)
})

test('live actions stopped before work starts never invoke generation', async () => {
  let recording = true
  const requests = createLiveActionsRequests({ recording: () => recording, generate: async () => assert.fail('must not generate') })
  const pending = requests.generate('meeting')
  recording = false
  requests.cancelStale()
  await assert.rejects(pending, /abort/i)
})
