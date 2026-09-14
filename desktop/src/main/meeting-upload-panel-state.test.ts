import type { MeetingUploadStatus } from '../shared/meeting-upload-contract'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { MeetingUploadPanelState, type MeetingUploadApi } from '../renderer/components/meeting-upload-panel-state.ts'
import assert from 'node:assert/strict'
import test from 'node:test'

// The renderer state is tested from the main tree because it has no DOM dependency.

function status(overrides: Partial<MeetingUploadStatus> = {}): MeetingUploadStatus {
  return {
    available: true,
    account: { enabled: true, pending: false, email: 'a@example.test', subject: 'user_a', error: null },
    consent: false, deleteConsent: false, accountDeleteConsent: false, revokeConsent: false, sending: false, result: null,
    queue: { pending: 0, failed: 0, entries: [] },
    ...overrides,
  }
}

function harness(t: { after(fn: () => void): void }) {
  const published: (MeetingUploadStatus | null)[] = []
  const errors: string[] = []
  const api: MeetingUploadApi = {
    status: async () => status(),
    connect: async (enabled) => status({ account: { enabled, pending: false, email: null, subject: null, error: null } }),
    setConsent: async (_subject, enabled) => status({ consent: enabled }),
    enqueue: async () => status({ queue: { pending: 1, failed: 0, entries: [{ localId: 'm1', revision: 1, state: 'pending', attempts: 0, updatedAt: '', error: null }] } }),
    sync: async () => status(),
    setDeleteConsent: async () => status({ deleteConsent: true }),
    deleteCopy: async () => status(),
    setAccountDeleteConsent: async () => status({ accountDeleteConsent: true }),
    deleteAll: async () => status(),
    allowUploads: async () => status({ result: 'allowed' }),
    setRevokeConsent: async () => status({ revokeConsent: true }),
    revokeClient: async () => status(),
  }
  const state = new MeetingUploadPanelState(api, (value, error) => { published.push(value); if (error) errors.push(error) })
  // Polling keeps a timer alive, so every test must release its own state.
  t.after(() => state.dispose())
  return { state, api, published, errors }
}

test('a stale status result never overwrites a newer action', async (t) => {
  const h = harness(t)
  let release: (value: MeetingUploadStatus) => void = () => {}
  h.api.status = () => new Promise((resolve) => { release = resolve })
  const slow = h.state.refresh()
  await h.state.run(async () => status({ consent: true }))
  release(status({ consent: false }))
  await slow
  assert.equal(h.published.at(-1)?.consent, true)
})

test('a failed action reports an error without inventing a status', async (t) => {
  const h = harness(t)
  await h.state.run(async () => { throw new Error('boom') })
  assert.equal(h.published.at(-1), null)
  assert.match(h.errors.at(-1) || '', /action failed/)
})

test('a closed panel publishes nothing more', async (t) => {
  const h = harness(t)
  h.state.dispose()
  const before = h.published.length
  await h.state.refresh()
  await h.state.run(async () => status({ consent: true }))
  assert.equal(h.published.length, before)
})

test('the panel polls the main process while it is open', async (t) => {
  const h = harness(t)
  await h.state.refresh()
  assert.equal(h.published.length, 1)
  h.state.dispose()
})
