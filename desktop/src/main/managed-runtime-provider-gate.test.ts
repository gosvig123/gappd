import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { createProviderChangeGate } from './managed-runtime-provider-gate.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test('provider change waits existing saves and blocks new saves', async () => {
  const gate = createProviderChangeGate()
  const save = deferred()
  const started = gate.runSave(gate.generation(), () => save.promise)
  const changePromise = gate.beginChange()
  assert.equal(gate.changing(), true)
  assert.equal(await gate.runSave(1, async () => {}), false)
  save.resolve()
  assert.equal(await started, true)
  const change = await changePromise
  assert.equal(change.generation, 1)
  gate.endChange(change)
  assert.equal(await gate.runSave(1, async () => {}), true)
})

test('concurrent provider changes serialize', async () => {
  const gate = createProviderChangeGate()
  const first = await gate.beginChange()
  let secondStarted = false
  const secondPromise = gate.beginChange().then((token) => { secondStarted = true; return token })
  await Promise.resolve()
  assert.equal(secondStarted, false)
  gate.endChange(first)
  const second = await secondPromise
  assert.equal(second.generation, 2)
  gate.endChange(second)
  assert.equal(gate.changing(), false)
})
