import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingSyncQueue } from './meeting-sync-queue.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingUpload } from './meeting-upload.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SecureJsonStore, type StoreCipher } from './secure-json-store.ts'
import type { CloudCredential } from './cloud-auth'
import type { MeetingSyncDocument } from '../shared/meeting-sync-contract'

const cipher: StoreCipher = {
  encrypt: (value) => Buffer.from(Buffer.from(value).toString('base64url')),
  decrypt: (value) => Buffer.from(value.toString(), 'base64url').toString(),
}

class FakeStore extends SecureJsonStore<MeetingSyncDocument> {
  override async read(): Promise<MeetingSyncDocument | null> { return this.stored }
  override async write(value: MeetingSyncDocument): Promise<void> { this.stored = structuredClone(value) }
  stored: MeetingSyncDocument | null = null
}

const MEETING = '72619a1d-f713-4f46-a2b8-c74e568726b1'
const OTHER = '11111111-1111-5111-8111-111111111111'
const credential = (subject = 'user_a', token = `token-${subject}`): CloudCredential => ({
  version: 1, issuer: 'https://issuer.test', clientId: 'desktop', subject, email: `${subject}@example.test`,
  tokens: { accessToken: token, expiresAt: Date.now() + 3600000, tokenType: 'Bearer' },
})

function harness(options: { available?: boolean; fetcher?: typeof fetch; saved?: CloudCredential | null } = {}) {
  let saved: CloudCredential | null = options.saved === undefined ? credential() : options.saved
  let requests: { url: string; method: string; body: string | undefined; authorization: string | null }[] = []
  const auth = {
    status: async () => ({ enabled: Boolean(saved), pending: false, subject: saved?.subject ?? null, email: saved?.email ?? null, error: null }),
    credential: async () => saved,
    setEnabled: async (enabled: unknown) => { saved = enabled ? credential() : null; return auth.status() },
  }
  const queue = new MeetingSyncQueue(new FakeStore('/tmp/unused.enc', cipher))
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input), method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      authorization: new Headers(init?.headers).get('Authorization'),
    })
    return options.fetcher ? options.fetcher(input, init) : accepted(1)
  }
  const upload = new MeetingUpload(auth, 'https://example.test/mcp', options.available ?? true, queue,
    async (_localId, revision) => `{"version":1,"revision":${revision}}`, fetcher)
  return {
    upload, queue, auth, requests, sends: () => requests.length,
    switch: (value: CloudCredential | null) => { saved = value },
  }
}

const accepted = (revision: number, subject = 'user_a') => Response.json(
  { status: 'accepted', subject, id: '11111111-1111-5111-8111-111111111111', revision, expires_at: '2026-10-13T12:00:00Z' })

test('signing in never permits an upload; the capability gate blocks everything', async () => {
  const h = harness()
  assert.equal((await h.upload.status()).consent, false)
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  assert.equal(h.sends(), 0)
  const disabled = harness({ available: false })
  await assert.rejects(disabled.upload.connect(true))
  await assert.rejects(disabled.upload.enqueue(MEETING))
  assert.equal(disabled.sends(), 0)
})

test('the explicit consent is required before any send', async () => {
  const h = harness()
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  assert.equal(h.sends(), 0)
  assert.equal((await h.upload.setConsent('user_a', true)).consent, true)
  const status = await h.upload.sync()
  assert.equal(h.sends(), 1)
  assert.equal(status.queue.pending, 0)
  assert.match(status.result || '', /Uploaded a Meeting copy/)
})

test('the document sent is the queued revision and carries the account token', async () => {
  const h = harness()
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  assert.equal(h.requests[0].url, 'https://example.test/meeting')
  assert.equal(h.requests[0].method, 'POST')
  assert.equal(h.requests[0].body, '{"version":1,"revision":1}')
  assert.equal(h.requests[0].authorization, 'Bearer token-user_a')
})

test('a consent for another account, or a changed token, sends nothing', async () => {
  const h = harness()
  assert.equal((await h.upload.setConsent('someone_else', true)).consent, false)
  await h.upload.setConsent('user_a', true)
  h.switch(credential('user_a', 'rotated'))
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  assert.equal(h.sends(), 0)
})

test('a refused document stops retrying but leaves other Meetings queued', async () => {
  // Only the first document is refused, so the second proves one bad Meeting is contained.
  const h = harness({ fetcher: async () => h.requests.length <= 1 ? new Response('invalid', { status: 400 }) : accepted(1) })
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  await h.upload.enqueue(OTHER)
  const status = await h.upload.sync()
  assert.equal(status.queue.failed, 1)
  assert.equal(status.queue.pending, 0)
  assert.match(status.queue.entries.filter((entry) => entry.state === 'failed')[0].error || '', /refused this Meeting document/)
})

test('a server problem is retried and never deletes the copy', async () => {
  const h = harness({ fetcher: async () => new Response('unavailable', { status: 503 }) })
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  const status = await h.upload.sync()
  assert.equal(status.queue.pending, 1)
  assert.equal(status.queue.entries[0].attempts, 1)
  assert.match(status.result || '', /may have accepted the copy; it will be retried/)
})

test('a stale acknowledgment for another revision keeps the work queued', async () => {
  const h = harness({ fetcher: async () => accepted(7) })
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  const status = await h.upload.sync()
  assert.equal(status.queue.entries[0].attempts, 1)
})

test('turning sync off drops consent and cancels locally', async () => {
  const h = harness()
  await h.upload.setConsent('user_a', true)
  assert.equal((await h.upload.status()).consent, true)
  const status = await h.upload.connect(false)
  assert.equal(status.consent, false)
  assert.equal(status.account.enabled, false)
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  assert.equal(h.sends(), 0)
})

test('deletion needs its own one-use confirmation for that Meeting', async () => {
  const h = harness({ fetcher: async () => Response.json({ status: 'deleted', subject: 'user_a' }) })
  await h.upload.setConsent('user_a', true)
  assert.equal((await h.upload.setDeleteConsent('user_a', true, MEETING)).deleteConsent, true)
  await h.upload.deleteCopy('user_a', OTHER)
  assert.equal(h.sends(), 0, 'another Meeting must not be deleted by that confirmation')
  await h.upload.deleteCopy('user_a', MEETING)
  assert.equal(h.sends(), 1)
  assert.equal(h.requests[0].method, 'DELETE')
  assert.equal(h.requests[0].body, JSON.stringify({ meeting_id: MEETING }))
  assert.equal((await h.upload.status()).deleteConsent, false)
})

test('a deletion without a confirmation sends nothing', async () => {
  const h = harness()
  await h.upload.setConsent('user_a', true)
  await h.upload.deleteCopy('user_a', MEETING)
  assert.equal(h.sends(), 0)
})
