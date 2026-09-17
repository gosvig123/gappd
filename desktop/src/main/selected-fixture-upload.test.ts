import assert from 'node:assert/strict'
import test from 'node:test'
import type { CloudCredential } from './cloud-auth'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SelectedFixtureUpload } from './selected-fixture-upload.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SELECTED_FIXTURE_BYTES as bytes, SELECTED_FIXTURE_ID as id } from '../shared/selected-fixture-contract.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { sendSelectedFixture } from './selected-fixture-send.ts'

function harness() {
  let credential: CloudCredential | null = { version: 1, issuer: 'https://issuer.test', clientId: 'desktop', subject: 'owner', email: 'owner@example.test', tokens: { accessToken: 'fixture-token', tokenType: 'Bearer', expiresAt: Date.now() + 3600000 } }
  let generation = 0
  const listeners = new Set<() => void>()
  const sent: RequestInit[] = []
  let content = bytes
  const auth = {
    credential: async () => credential,
    authorizationGeneration: () => generation,
    invalidateAuthorization: () => { generation++; for (const listener of listeners) listener(); return generation },
    observeAuthorization: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    status: async () => ({ enabled: Boolean(credential), pending: false, subject: credential?.subject ?? null, email: credential?.email ?? null, error: null }),
    setEnabled: async (enabled: unknown) => { generation++; for (const listener of listeners) listener(); if (!enabled) credential = null; return auth.status() },
  }
  const fetcher: typeof fetch = async (_url, init) => { sent.push(init!); return Response.json({ status: init?.method === 'DELETE' ? 'deleted' : 'accepted', subject: 'owner', id, expires_at: '2026-10-14T12:00:00Z' }) }
  const upload = new SelectedFixtureUpload(auth, async selected => { assert.equal(selected, id); return content }, true, 'https://cloud.test/mcp', fetcher)
  return { upload, auth, sent, edit: (value: string) => { content = value }, replace: (change: Partial<CloudCredential>) => { credential = { ...credential!, ...change } }, credential: () => credential!, fetcher }
}

async function consent(h: ReturnType<typeof harness>) {
  assert.equal((await h.upload.preview(id)).preview, bytes)
  assert.equal((await h.upload.setConsent('owner', true, 'upload')).consent, true)
}

test('Verified export bytes shown in preview are retained and sent exactly once', async () => {
  const h = harness()
  await h.upload.status(); await h.upload.perform('owner', 'upload')
  assert.equal(h.sent.length, 0)
  await consent(h)
  assert.match((await h.upload.perform('owner', 'upload')).result!, /Accepted cloud Meeting/)
  assert.equal(h.sent[0].body, bytes)
  await h.upload.perform('owner', 'upload')
  assert.equal(h.sent.length, 1)
})

test('nonfixture, edits, arbitrary IDs and replacement authorization fail before egress', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => h.edit(bytes.replace('paper prototype', 'private client acquisition')),
    (h: ReturnType<typeof harness>) => h.replace({ subject: 'other-owner' }),
    (h: ReturnType<typeof harness>) => h.replace({ tokens: { ...h.credential().tokens, accessToken: 'replacement' } }),
    (h: ReturnType<typeof harness>) => h.replace({ tokens: { ...h.credential().tokens, expiresAt: 0 } }),
    (h: ReturnType<typeof harness>) => h.upload.cancel(),
  ]) {
    const h = harness(); await consent(h); change(h)
    await h.upload.perform('owner', 'upload'); assert.equal(h.sent.length, 0)
  }
  const h = harness(); await consent(h)
  await assert.rejects(h.upload.preview('real-meeting'))
  await h.upload.perform('owner', 'upload'); assert.equal(h.sent.length, 0)
  await assert.rejects(sendSelectedFixture(h.fetcher, 'https://cloud.test', h.credential(), '{"synthetic":true,"transcript":"private"}', 'upload', new AbortController().signal))
  assert.equal(h.sent.length, 0)
})

test('shared auth reconnect and OFF invalidate preview and consent on every consumer', async () => {
  const h = harness(); await consent(h)
  await h.auth.setEnabled(true)
  assert.equal((await h.upload.status()).preview, null)
  await h.upload.perform('owner', 'upload'); assert.equal(h.sent.length, 0)
  await consent(h); await h.auth.setEnabled(false)
  await h.upload.perform('owner', 'upload'); assert.equal(h.sent.length, 0)
})

test('delete requires separate consent and sends no document body', async () => {
  const h = harness(); await consent(h)
  await h.upload.perform('owner', 'delete'); assert.equal(h.sent.length, 0)
  await h.upload.setConsent('owner', true, 'delete')
  await h.upload.perform('owner', 'delete')
  assert.equal(h.sent[0].method, 'DELETE'); assert.equal(h.sent[0].body, undefined)
})

test('lost or oversized acknowledgment is uncertain, never retried', async () => {
  const h = harness()
  for (const fetcher of [async () => { throw new Error('lost') }, async () => new Response('x'.repeat(4097))]) {
    assert.match(await sendSelectedFixture(fetcher, 'https://cloud.test', h.credential(), bytes, 'upload', new AbortController().signal), /may have accepted/)
  }
})

test('cancel during reread cannot send or restore an obsolete preview', async () => {
  const h = harness()
  let release!: (value: string) => void
  let reads = 0
  const upload = new SelectedFixtureUpload(h.auth, async () => ++reads === 1 ? bytes : new Promise(resolve => { release = resolve }), true, 'https://cloud.test', h.fetcher)
  await upload.preview(id); await upload.setConsent('owner', true, 'upload')
  const pending = upload.perform('owner', 'upload')
  upload.cancel(); release(bytes); await pending
  assert.equal(h.sent.length, 0); assert.equal((await upload.status()).preview, null)
})

test('disabled capability refuses preview and never reads the local Meeting', async () => {
  const h = harness()
  const upload = new SelectedFixtureUpload(h.auth, async () => { throw new Error('must not read') }, false, 'https://cloud.test', h.fetcher)
  await assert.rejects(upload.preview(id)); await assert.rejects(upload.connect(true))
  await upload.perform('owner', 'upload'); assert.equal(h.sent.length, 0)
})

test('shared reconnect invalidates old-demo and selected-demo consent together', async () => {
  // @ts-expect-error Node type stripping requires explicit TypeScript extension.
  const { DemoUpload } = await import('./demo-upload.ts')
  const h = harness()
  const legacy = new DemoUpload(h.auth, 'https://cloud.test', true, h.fetcher)
  await legacy.setConsent('owner', true); await consent(h)
  await h.upload.connect(true)
  assert.equal((await legacy.status()).consent, false)
  await legacy.upload('owner'); await h.upload.perform('owner', 'upload')
  assert.equal(h.sent.length, 0)
})
