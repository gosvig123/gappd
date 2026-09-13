import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import type { CloudCredential } from './cloud-auth'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { DemoUpload } from './demo-upload.ts'

const id = '11111111-1111-5111-8111-111111111111'
const credential = (subject = 'user_a'): CloudCredential => ({ version: 1, issuer: 'https://issuer.test', clientId: 'desktop', subject, email: `${subject}@example.test`, tokens: { accessToken: `synthetic-${subject}`, expiresAt: Date.now() + 3600000, tokenType: 'Bearer' } })

function harness(fetcher: typeof fetch = async () => Response.json({ id, expires_at: '2026-10-13T12:00:00Z', status: 'accepted', subject: 'user_a' }), available = true) {
  let saved: CloudCredential | null = credential()
  let sends = 0
  const auth = {
    status: async () => ({ enabled: Boolean(saved), pending: false, subject: saved?.subject ?? null, email: saved?.email ?? null, error: null }),
    credential: async () => saved,
    setEnabled: async (enabled: unknown) => { saved = enabled ? credential() : null; return auth.status() },
  }
  const demo = new DemoUpload(auth, 'https://example.test/mcp', available, async (url, init) => { sends++; return fetcher(url, init) })
  return { demo, auth, sends: () => sends, switch: (value: CloudCredential | null) => { saved = value } }
}

async function consent(h: ReturnType<typeof harness>) {
  assert.equal((await h.demo.setConsent('user_a', true)).consent, true)
}

test('saved auth and startup never imply consent; disabled capability never sends', async () => {
  const h = harness()
  assert.equal((await h.demo.status()).consent, false)
  await h.demo.upload('user_a')
  assert.equal(h.sends(), 0)
  const disabled = harness(undefined, false)
  assert.equal((await disabled.demo.status()).available, false)
  assert.equal((await disabled.demo.setConsent('user_a', true)).consent, false)
  await assert.rejects(disabled.demo.connect(true))
  await assert.rejects(disabled.demo.upload('user_a'))
  assert.equal(disabled.sends(), 0)
})

test('final action sends empty POST exactly once and displays returned ID', async () => {
  const h = harness(async (url, init) => {
    assert.equal(String(url), 'https://example.test/demo-meeting')
    assert.equal(init?.method, 'POST'); assert.equal(init?.body, undefined)
    assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-user_a')
    return Response.json({ id, expires_at: '2026-10-13T12:00:00Z', status: 'accepted', subject: 'user_a' })
  })
  await consent(h)
  const result = await h.demo.upload('user_a')
  assert.match(result.result || '', /Accepted synthetic demo Meeting/)
  assert.match(result.result || '', new RegExp(id))
  assert.equal(result.consent, false)
  await h.demo.upload('user_a'); assert.equal(h.sends(), 1)
})

test('account/token replacement and expiry invalidate consent before transport', async () => {
  for (const value of [credential('user_b'), { ...credential(), tokens: { ...credential().tokens, accessToken: 'replacement' } }, null]) {
    const h = harness(); await consent(h); h.switch(value)
    await h.demo.upload('user_a'); assert.equal(h.sends(), 0)
  }
  const h = harness(); await consent(h)
  await h.demo.setConsent('user_a', false); await h.demo.upload('user_a')
  assert.equal(h.sends(), 0)
})

test('OFF while credential lookup is pending prevents the send', async () => {
  const h = harness(); await consent(h)
  let release!: (value: CloudCredential) => void
  h.auth.credential = () => new Promise(resolve => { release = resolve })
  const upload = h.demo.upload('user_a')
  await h.demo.connect(false)
  release(credential()); await upload
  assert.equal(h.sends(), 0)
  assert.equal((await h.demo.status()).consent, false)
})

test('OFF after send reports uncertainty; stale acknowledgment cannot restore consent or account', async () => {
  let release!: (response: Response) => void
  let sent!: () => void
  const started = new Promise<void>(resolve => { sent = resolve })
  const h = harness(async () => { sent(); return new Promise(resolve => { release = resolve }) })
  await consent(h)
  const upload = h.demo.upload('user_a'); await started
  const off = await h.demo.connect(false)
  assert.match(off.result || '', /may already have accepted/)
  release(Response.json({ id, expires_at: '2026-10-13T12:00:00Z', status: 'accepted', subject: 'user_a' }))
  const result = await upload
  assert.equal(result.account.enabled, false); assert.equal(result.consent, false)
  assert.match(result.result || '', /may already have accepted/)
})

test('network failure and invalid acknowledgments never claim success or retry', async () => {
  for (const fetcher of [async () => { throw new Error('secret') }, async () => Response.json({ id, expires_at: '2026-10-13T12:00:00Z', status: 'accepted', subject: 'user_b' }), async () => Response.json({ id }, { status: 403 })]) {
    const h = harness(fetcher); await consent(h)
    const result = await h.demo.upload('user_a')
    assert.match(result.result || '', /No acknowledgment/)
    assert.doesNotMatch(result.result || '', /secret/)
    assert.equal(result.consent, false); assert.equal(h.sends(), 1)
  }
})

test('real loopback HTTP transport has no payload and returns a synthetic acknowledgment', async context => {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      assert.equal(body, ''); assert.equal(request.method, 'POST')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ id, expires_at: '2026-10-13T12:00:00Z', status: 'accepted', subject: 'user_a' }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const h = harness()
  const demo = new DemoUpload(h.auth, `http://127.0.0.1:${address.port}/mcp`, true)
  await demo.setConsent('user_a', true)
  assert.match((await demo.upload('user_a')).result || '', /Accepted synthetic/)
})

test('late consent lookup cannot bind old account token after account switch', async () => {
  const h = harness()
  let release!: (value: CloudCredential) => void
  h.auth.credential = () => new Promise(resolve => { release = resolve })
  const pendingConsent = h.demo.setConsent('user_a', true)
  await h.demo.connect(false)
  h.switch(credential('user_b'))
  release(credential())
  assert.equal((await pendingConsent).consent, false)
  assert.equal((await h.demo.status()).account.subject, 'user_b')
  assert.equal(h.sends(), 0)
})

test('OFF after an acknowledged request preserves accepted result, not a cancellation claim', async () => {
  const h = harness(); await consent(h)
  await h.demo.upload('user_a')
  const off = await h.demo.connect(false)
  assert.match(off.result || '', /Accepted synthetic demo Meeting/)
  assert.equal(off.consent, false); assert.equal(off.account.enabled, false)
})
