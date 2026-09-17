import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { CloudAuth, type CloudCredential } from './cloud-auth.ts'
const config = { issuer: 'https://issuer.example', clientId: 'desktop' }

function harness(options: { fail?: boolean; secure?: boolean; pause?: boolean; timeoutMs?: number; invalidUser?: boolean; resource?: string; refreshTokens?: boolean } = {}) {
  let saved: CloudCredential | null = null
  let browserUrl = ''
  let opened!: () => void
  const browser = new Promise<void>(resolve => { opened = resolve })
  const store = { read: async () => saved, write: async (value: CloudCredential) => { saved = value }, clear: async () => { saved = null } }
  const dependencies = {
    requireSecureStorage: () => { if (options.secure === false) throw new Error('unavailable') },
    openExternal: async (url: string) => { browserUrl = url; opened(); if (!options.pause) await callback(url) },
    fetcher: async (url: string | URL | Request) => {
      if (options.fail) throw new Error('provider secret must not escape')
      return String(url).endsWith('/userinfo') ? Response.json({ sub: 'user_1', email: 'test@example.com', email_verified: !options.invalidUser }) : Response.json({ access_token: 'synthetic-access', token_type: 'Bearer', expires_in: 3600, refresh_token: 'synthetic-refresh' })
    },
    timeoutMs: options.timeoutMs ?? 500,
  }
  return { auth: new CloudAuth({ ...config, refreshTokens: options.refreshTokens, ...(options.resource ? { resource: options.resource } : {}) }, store, dependencies), store, dependencies, browser, url: () => browserUrl }
}

async function callback(url: string, overrides: Record<string, string> = {}) {
  const authorization = new URL(url)
  const callback = new URL(authorization.searchParams.get('redirect_uri')!)
  callback.searchParams.set('state', authorization.searchParams.get('state')!)
  callback.searchParams.set('iss', config.issuer)
  callback.searchParams.set('code', 'synthetic-code')
  for (const [key, value] of Object.entries(overrides)) callback.searchParams.set(key, value)
  return fetch(callback)
}

test('default OFF, no startup browser or cloud access; happy auth survives restart without exposing tokens', async () => {
  const h = harness()
  assert.equal((await h.auth.status()).enabled, false)
  assert.equal(h.url(), '')
  const status = await h.auth.setEnabled(true)
  assert.equal(status.enabled, true)
  assert.equal(status.email, 'test@example.com')
  assert.equal(JSON.stringify(status).includes('synthetic-access'), false)
  assert.equal(new URL(h.url()).searchParams.get('scope'), 'email profile')
  const restarted = new CloudAuth(config, h.store, { ...h.dependencies, openExternal: async () => { throw new Error('must not launch') } })
  assert.equal((await restarted.status()).enabled, true)
  await restarted.setEnabled(false)
  assert.equal(await h.store.read(), null)
})

test('failed auth, unverified identity and unavailable secure storage stay OFF with safe errors', async () => {
  for (const options of [{ fail: true }, { secure: false }, { invalidUser: true }]) {
    const h = harness(options)
    const status = await h.auth.setEnabled(true)
    assert.equal(status.enabled, false)
    assert.ok(status.error)
    assert.equal(status.error.includes('secret'), false)
    assert.equal(await h.store.read(), null)
    if (options.secure === false) assert.equal(h.url(), '')
  }
})

test('OFF cancels pending browser login and late callbacks cannot restore credentials', async () => {
  const h = harness({ pause: true })
  const login = h.auth.setEnabled(true)
  await h.browser
  assert.equal((await h.auth.status()).pending, true)
  assert.equal((await h.auth.setEnabled(false)).enabled, false)
  await callback(h.url()).catch(() => undefined)
  assert.equal((await login).enabled, false)
  assert.equal(await h.store.read(), null)
})

test('timeout, denied consent, wrong issuer and wrong state remain OFF', async () => {
  const timeout = harness({ pause: true, timeoutMs: 10 })
  assert.equal((await timeout.auth.setEnabled(true)).enabled, false)
  for (const overrides of [{ error: 'access_denied' }, { iss: 'https://wrong.example' }, { state: 'wrong' }] as Record<string, string>[]) {
    const h = harness({ pause: true })
    const login = h.auth.setEnabled(true)
    await h.browser
    await callback(h.url(), overrides)
    assert.equal((await login).enabled, false)
    assert.equal(await h.store.read(), null)
  }
})

test('IPC rejects non-booleans; expired or differently bound credentials need explicit reconnect', async () => {
  const h = harness()
  await assert.rejects(h.auth.setEnabled('true'), /boolean/)
  await h.auth.setEnabled(true)
  const saved = await h.store.read()
  assert.ok(saved)
  await h.store.write({ ...saved, tokens: { ...saved.tokens, expiresAt: 0 } })
  assert.equal((await h.auth.status()).enabled, false)
  await h.store.write({ ...saved, clientId: 'other-client' })
  assert.equal((await h.auth.status()).enabled, false)
})

test('OFF waits for an in-flight protected write then removes it', async () => {
  const h = harness()
  let release!: () => void
  let started!: () => void
  const writing = new Promise<void>(resolve => { started = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const write = h.store.write
  h.store.write = async value => { started(); await blocked; await write(value) }
  const login = h.auth.setEnabled(true)
  await writing
  const off = h.auth.setEnabled(false)
  release()
  await Promise.all([login, off])
  assert.equal(await h.store.read(), null)
  assert.equal((await h.auth.status()).enabled, false)
})

test('protected persistence failures never report connected', async () => {
  const h = harness()
  h.store.write = async () => { throw new Error('cipher failed') }
  const status = await h.auth.setEnabled(true)
  assert.equal(status.enabled, false)
  assert.ok(status.error)
})

test('failed credential deletion stays OFF and a removal retry clears credentials', async () => {
  const h = harness()
  await h.auth.setEnabled(true)
  const clear = h.store.clear
  h.store.clear = async () => { throw new Error('disk failure') }
  const off = await h.auth.setEnabled(false)
  assert.equal(off.enabled, false)
  assert.match(off.error || '', /Remove local credentials to retry before restarting/)
  assert.equal((await h.auth.status()).enabled, false)
  h.store.clear = clear
  const retried = await h.auth.setEnabled(false)
  assert.equal(retried.error, null)
  assert.equal(retried.enabled, false)
  assert.equal(await h.store.read(), null)
})

test('malformed token lifetime or type cannot be persisted', async () => {
  for (const value of [{ access_token: 'synthetic', token_type: 'Bearer' }, { access_token: '', token_type: 'Bearer', expires_in: 3600 }, { access_token: 'synthetic', token_type: 'Other', expires_in: 3600 }]) {
    const h = harness()
    h.dependencies.fetcher = async () => Response.json(value)
    assert.equal((await h.auth.setEnabled(true)).enabled, false)
    assert.equal(await h.store.read(), null)
  }
})


test('persistent sync requests offline access; reconnect creates a new authorization without upload consent', async () => {
  const h = harness({ resource: 'https://example.test/mcp', refreshTokens: true })
  await h.auth.setEnabled(true)
  assert.equal(new URL(h.url()).searchParams.get('scope'), 'email profile meetings:sync offline_access')
  const first = await h.auth.credential()
  assert.ok(first?.authorizationId)
  assert.equal(first.tokens.refreshToken, 'synthetic-refresh')
  await h.auth.setUploadConsent(first)
  assert.equal((await h.auth.savedUploadCredential())?.uploadConsent, true)
  await h.auth.setEnabled(true)
  assert.notEqual((await h.auth.credential())?.authorizationId, first.authorizationId)
  assert.equal(await h.auth.savedUploadCredential(), null)
  const preview = harness()
  await preview.auth.setEnabled(true)
  assert.equal((await preview.auth.credential())?.tokens.refreshToken, undefined)
})

test('demo authorization explicitly requests sync resource and binds protected credentials', async () => {
  const h = harness({ resource: 'https://example.test/mcp' })
  let tokenUsed = ''
  const fetcher = h.dependencies.fetcher
  h.dependencies.fetcher = async (url, init?: RequestInit) => {
    if (String(url).endsWith('/userinfo')) {
      tokenUsed = new Headers(init?.headers).get('Authorization') || ''
      assert.equal(init?.redirect, 'error')
    }
    return fetcher(url)
  }
  await h.auth.setEnabled(true)
  assert.equal(new URL(h.url()).searchParams.get('scope'), 'email profile meetings:sync')
  assert.equal(new URL(h.url()).searchParams.get('resource'), 'https://example.test/mcp')
  assert.equal(tokenUsed, 'Bearer synthetic-access')
  assert.equal((await h.auth.credential())?.resource, 'https://example.test/mcp')
  const oldAuth = new CloudAuth(config, h.store, h.dependencies)
  assert.equal(await oldAuth.credential(), null)
})
