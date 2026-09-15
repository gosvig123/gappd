import assert from 'node:assert/strict'
import test from 'node:test'
import type { CloudAuthStatus } from '../shared/cloud-auth-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { CloudAuthPanelState } from '../renderer/components/cloud-auth-panel-state.ts'

const off: CloudAuthStatus = { enabled: false, pending: false, email: null, subject: null, error: null }
const pending: CloudAuthStatus = { ...off, pending: true }
const connected: CloudAuthStatus = { ...off, enabled: true, email: 'test@example.com', subject: 'synthetic-user' }
const failed: CloudAuthStatus = { ...off, error: 'Sign-in timed out. Retry.' }
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

for (const result of [connected, failed]) {
  test(`reopened panel observes pending login completion: ${result.enabled ? 'success' : 'timeout'}`, async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    let status = pending
    let reads = 0
    const api = { status: async () => { reads++; return status }, setEnabled: async () => status }
    const oldValues: CloudAuthStatus[] = [], values: CloudAuthStatus[] = []
    const old = new CloudAuthPanelState(api, value => oldValues.push(value))
    await old.refresh(); old.dispose()
    const reopened = new CloudAuthPanelState(api, value => values.push(value))
    context.after(() => reopened.dispose())
    await reopened.refresh()
    assert.equal(values.at(-1)?.pending, true)
    status = result
    context.mock.timers.tick(1000); await flush()
    assert.deepEqual(values.at(-1), result)
    assert.equal(oldValues.length, 1)
    context.mock.timers.tick(10_000); await flush()
    assert.equal(reads, 3)
  })
}

test('Remove local credentials retries OFF without starting browser login', async () => {
  const calls: boolean[] = [], values: CloudAuthStatus[] = []
  let removalFailed = true
  const controller = new CloudAuthPanelState({ status: async () => off, setEnabled: async enabled => {
    calls.push(enabled)
    return removalFailed ? { ...off, error: 'Choose Remove local credentials to retry before restarting.' } : off
  } }, value => values.push(value))
  await controller.update(false)
  assert.match(values.at(-1)?.error || '', /Remove local credentials/)
  removalFailed = false
  await controller.update(false)
  assert.deepEqual(calls, [false, false])
  assert.deepEqual(values.at(-1), off)
  controller.dispose()
})

test('new OFF action ignores an older pending status response', async () => {
  let resolve!: (value: CloudAuthStatus) => void
  const values: CloudAuthStatus[] = []
  const controller = new CloudAuthPanelState({ status: () => new Promise(done => { resolve = done }), setEnabled: async () => off }, value => values.push(value))
  const read = controller.refresh()
  await controller.update(false)
  resolve(connected); await read
  assert.deepEqual(values.at(-1), off)
  assert.equal(values.length, 2)
  controller.dispose()
})

test('unmount ignores late operation errors and removes pending refresh timers', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let reads = 0
  let reject!: (error: Error) => void
  const values: CloudAuthStatus[] = []
  const controller = new CloudAuthPanelState({ status: async () => { reads++; return pending }, setEnabled: () => new Promise((_resolve, fail) => { reject = fail }) }, value => values.push(value))
  await controller.refresh()
  const update = controller.update(true)
  controller.dispose()
  reject(new Error('synthetic failure')); await update
  context.mock.timers.tick(10_000); await flush()
  assert.equal(reads, 1)
  assert.equal(values.length, 2)
})

test('pending refresh is bounded and provides a recovery action', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let reads = 0
  const values: CloudAuthStatus[] = []
  const controller = new CloudAuthPanelState({ status: async () => { reads++; return pending }, setEnabled: async () => off }, value => values.push(value))
  await controller.refresh()
  for (let i = 0; i < 361; i++) { context.mock.timers.tick(1000); await flush() }
  assert.equal(reads, 361)
  assert.equal(values.at(-1)?.pending, false)
  assert.match(values.at(-1)?.error || '', /Reopen Settings/)
  controller.dispose()
})
