import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { CloudAuth, type CloudCredential } from './cloud-auth.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { harness, credential, meetingItem, MEETING, OTHER, FakeStore, cipher } from './meeting-upload-harness.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { MeetingSyncQueue } from './meeting-sync-queue.ts'

function fixture() {
  let value: CloudCredential | null = { ...credential(), resource: 'https://example.test/mcp' }
  const store = { read: async () => value, write: async (next: CloudCredential) => { value = structuredClone(next) }, clear: async () => { value = null } }
  const config = { issuer: value.issuer, clientId: value.clientId, resource: value.resource, refreshTokens: true }
  const dependencies = { requireSecureStorage: () => {}, openExternal: async () => assert.fail('no startup browser'),
    fetcher: (async url => String(url).endsWith('/userinfo')
      ? Response.json({ sub: 'user_a', email: 'user_a@example.test', email_verified: true })
      : Response.json({ access_token: 'renewed', refresh_token: 'next-refresh', expires_in: 3600, token_type: 'Bearer' })) as typeof fetch }
  const queueStore = new FakeStore('/tmp/unused.enc', cipher)
  const meetings = [meetingItem(MEETING)]
  const start = () => harness({ auth: new CloudAuth(config, store, dependencies), queue: new MeetingSyncQueue(queueStore), meetings })
  return { store, start, meetings }
}

test('one consent survives restart and token refresh; destructive confirmations do not', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = fixture()
  const first = f.start()
  await first.upload.syncNew()
  assert.equal(first.sends(), 0, 'sign-in alone is not consent')
  await first.upload.setConsent('user_a', true)
  assert.equal(first.sends(), 1)
  await first.upload.setDeleteConsent('user_a', true, MEETING)
  await first.upload.setAccountDeleteConsent('user_a', true)
  await first.upload.setRevokeConsent('user_a', true, 'client')
  const saved = (await f.store.read())!
  await f.store.write({ ...saved, tokens: { ...saved.tokens, expiresAt: 0, refreshToken: 'refresh' } })
  f.meetings.push(meetingItem(OTHER))
  const restarted = f.start()
  await restarted.upload.syncNew()
  const status = await restarted.upload.status()
  assert.equal(status.consent, true)
  assert.equal(restarted.sends(), 1, 'only the newly completed Meeting uploads after restart')
  assert.equal(restarted.requests[0].authorization, 'Bearer renewed')
  assert.equal(status.deleteConsent, false)
  assert.equal(status.accountDeleteConsent, false)
  assert.equal(status.revokeConsent, false)
  await restarted.upload.setConsent('user_a', false)
  const off = f.start()
  await off.upload.syncNew()
  assert.equal((await off.upload.status()).consent, false)
  assert.equal(off.sends(), 0)
})

test('disconnect, another account, or another authorization cannot inherit saved consent', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = fixture()
  await f.start().upload.setConsent('user_a', true)
  await f.store.write({ ...credential('user_b'), resource: 'https://example.test/mcp' })
  const other = f.start()
  await other.upload.syncNew()
  assert.equal((await other.upload.status()).consent, false)
  assert.equal(other.sends(), 0)
  await other.upload.setConsent('user_b', true)
  await other.upload.connect(false)
  const disconnected = f.start()
  await disconnected.upload.syncNew()
  assert.equal(disconnected.sends(), 0)
  assert.equal(await f.store.read(), null)
})

test('OFF during saved consent restoration cannot start an upload', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = fixture()
  await f.start().upload.setConsent('user_a', true)
  const read = f.store.read
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(r => { entered = r })
  const gate = new Promise<void>(r => { release = r })
  f.store.read = async () => { const value = await read(); entered(); await gate; return value }
  const restarted = f.start()
  const restoring = restarted.upload.syncNew()
  await started
  const off = restarted.upload.connect(false)
  release()
  await Promise.all([restoring, off])
  assert.equal(restarted.sends(), 0)
  assert.equal((await restarted.upload.status()).consent, false)
  assert.equal(await f.store.read(), null)
})

test('a locked store can retry restoration; failed consent persistence never starts uploads', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const f = fixture()
  await f.start().upload.setConsent('user_a', true)
  f.meetings.push(meetingItem(OTHER))
  const read = f.store.read
  f.store.read = async () => { throw Error('locked') }
  const restarted = f.start()
  await assert.rejects(restarted.upload.syncNew())
  assert.equal(restarted.sends(), 0)
  f.store.read = read
  await restarted.upload.syncNew()
  assert.equal(restarted.sends(), 1)
  const denied = fixture()
  denied.store.write = async () => { throw Error('disk failure') }
  const unsaved = denied.start()
  await assert.rejects(unsaved.upload.setConsent('user_a', true))
  await unsaved.upload.syncNew()
  assert.equal(unsaved.sends(), 0)
  assert.equal((await unsaved.upload.status()).consent, false)
})
