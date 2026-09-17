import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { CloudAuth, type CloudCredential } from './cloud-auth.ts'

const config = { issuer: 'https://issuer.test', clientId: 'desktop', resource: 'https://cloud.test/mcp', refreshTokens: true }
const original = (): CloudCredential => ({ version: 1, issuer: config.issuer, clientId: config.clientId, resource: config.resource,
  subject: 'owner', email: 'owner@example.test', authorizationId: 'grant-one', uploadConsent: true,
  tokens: { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 0, tokenType: 'Bearer' } })

function fixture(fetcher?: typeof fetch) {
  let saved: CloudCredential | null = original()
  let refreshes = 0
  const store = { read: async () => saved, write: async (value: CloudCredential) => { saved = structuredClone(value) }, clear: async () => { saved = null } }
  const dependencies = { now: () => 100_000, requireSecureStorage: () => {}, openExternal: async () => assert.fail('must not open a browser'),
    fetcher: fetcher ?? (async (url, init) => {
      if (String(url).endsWith('/userinfo')) return Response.json({ sub: 'owner', email: 'owner@example.test', email_verified: true })
      refreshes++
      const body = new URLSearchParams(String(init?.body))
      assert.equal(body.get('grant_type'), 'refresh_token')
      assert.equal(body.get('refresh_token'), 'old-refresh')
      assert.equal(body.get('client_id'), config.clientId)
      assert.equal(init?.redirect, 'error')
      return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer' })
    }) as typeof fetch }
  return { auth: new CloudAuth(config, store, dependencies), store, dependencies, refreshes: () => refreshes }
}

test('saved upload consent survives restart and one refresh rotates protected tokens without changing its grant', async () => {
  const h = fixture()
  assert.equal((await h.auth.savedUploadCredential())?.uploadConsent, true)
  assert.equal(h.refreshes(), 0, 'restoring intent is not a network operation')
  const [a, b] = await Promise.all([h.auth.credential(), h.auth.credential()])
  assert.equal(h.refreshes(), 1)
  assert.equal(a?.tokens.accessToken, 'new-access')
  assert.equal(b?.tokens.refreshToken, 'new-refresh')
  assert.equal(a?.authorizationId, 'grant-one')
  assert.equal(a?.uploadConsent, true)
  const restarted = new CloudAuth(config, h.store, h.dependencies)
  assert.equal((await restarted.savedUploadCredential())?.uploadConsent, true)
  assert.equal((await restarted.credential())?.tokens.accessToken, 'new-access')
  assert.equal(h.refreshes(), 1)
  assert.doesNotMatch(JSON.stringify(await restarted.status()), /new-access|new-refresh|grant-one/)
})

test('temporary refresh failure preserves intent and retries; revoked refresh credentials require reconnect', async () => {
  let offline = true
  const h = fixture(async url => {
    if (offline) throw Error('private provider details')
    if (String(url).endsWith('/userinfo')) return Response.json({ sub: 'owner', email: 'owner@example.test', email_verified: true })
    return Response.json({ access_token: 'renewed', expires_in: 3600, token_type: 'Bearer' })
  })
  assert.equal(await h.auth.credential(), null)
  assert.equal((await h.auth.savedUploadCredential())?.uploadConsent, true)
  assert.doesNotMatch(JSON.stringify(await h.auth.status()), /private provider details/)
  offline = false
  assert.equal((await h.auth.credential())?.tokens.refreshToken, 'old-refresh')
  const revoked = fixture(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
  assert.equal(await revoked.auth.credential(), null)
  assert.equal(await revoked.store.read(), null)
  assert.match((await revoked.auth.status()).error || '', /Reconnect/)
})

test('a temporary identity-check failure retains rotated tokens but blocks their use until verified', async () => {
  let tokenRequests = 0
  let available = false
  const h = fixture(async url => {
    if (String(url).endsWith('/userinfo')) return available
      ? Response.json({ sub: 'owner', email: 'owner@example.test', email_verified: true })
      : new Response(null, { status: 503 })
    tokenRequests++
    return Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer' })
  })
  assert.equal(await h.auth.credential(), null)
  assert.equal((await h.store.read())?.tokens.refreshToken, 'rotated-refresh')
  assert.equal((await h.store.read())?.verificationPending, true)
  const restarted = new CloudAuth(config, h.store, h.dependencies)
  assert.equal(await restarted.credential(), null)
  available = true
  assert.equal((await restarted.credential())?.tokens.accessToken, 'rotated')
  assert.equal(tokenRequests, 1, 'the old refresh token must never be replayed')
  assert.equal((await h.store.read())?.verificationPending, false)
})

test('OFF while refresh is pending cannot restore credentials or consent', async () => {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(r => { entered = r })
  const gate = new Promise<void>(r => { release = r })
  const h = fixture(async url => {
    if (String(url).endsWith('/userinfo')) return Response.json({ sub: 'owner', email: 'owner@example.test', email_verified: true })
    entered(); await gate
    return Response.json({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600, token_type: 'Bearer' })
  })
  const refresh = h.auth.credential()
  await started
  const off = h.auth.setEnabled(false)
  release()
  await Promise.all([refresh, off])
  assert.equal(await h.store.read(), null)
  assert.equal(await h.auth.savedUploadCredential(), null)
})

test('refresh cannot change the account; consent writes cannot bind a stale credential', async () => {
  const switched = fixture(async url => String(url).endsWith('/userinfo')
    ? Response.json({ sub: 'someone-else', email: 'other@example.test', email_verified: true })
    : Response.json({ access_token: 'new', expires_in: 3600, token_type: 'Bearer' }))
  assert.equal(await switched.auth.credential(), null)
  assert.equal(await switched.store.read(), null)
  const h = fixture()
  const current = await h.auth.credential()
  assert.ok(current)
  await assert.rejects(h.auth.setUploadConsent({ ...current, subject: 'someone-else' }))
  await h.auth.setUploadConsent(null)
  assert.equal(await h.auth.savedUploadCredential(), null)
  assert.equal((await h.store.read())?.uploadConsent, false)
  await h.auth.setUploadConsent(current)
  assert.equal((await h.auth.savedUploadCredential())?.uploadConsent, true)
})
