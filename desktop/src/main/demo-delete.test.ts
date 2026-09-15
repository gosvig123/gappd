import assert from 'node:assert/strict'
import test from 'node:test'
import type { CloudCredential } from './cloud-auth'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { DemoUpload } from './demo-upload.ts'

const credential = (subject = 'account-a'): CloudCredential => ({ version: 1, issuer: 'https://issuer.test', clientId: 'desktop', subject, email: `${subject}@example.test`, tokens: { accessToken: `synthetic-${subject}`, expiresAt: Date.now() + 3600000, tokenType: 'Bearer' } })
function harness(fetcher: typeof fetch = async () => Response.json({ status: 'deleted', subject: 'account-a' })) {
  let saved: CloudCredential | null = credential()
  let sends = 0
  const auth = {
    status: async () => ({ enabled: Boolean(saved), pending: false, subject: saved?.subject ?? null, email: saved?.email ?? null, error: null }),
    credential: async () => saved && saved.tokens.expiresAt > Date.now() + 60_000 ? saved : null,
    setEnabled: async (enabled: unknown) => { saved = enabled ? credential() : null; return auth.status() },
  }
  const demo = new DemoUpload(auth, 'https://example.test/mcp', true, async (url, init) => { sends++; return fetcher(url, init) })
  return { demo, auth, sends: () => sends, switch: (value: CloudCredential | null) => { saved = value } }
}

test('delete requires separate one-use confirmation and sends only empty DELETE', async () => {
  const h = harness(async (url, init) => {
    assert.equal(String(url), 'https://example.test/demo-meeting')
    assert.equal(init?.method, 'DELETE'); assert.equal(init?.body, undefined)
    assert.equal(init?.redirect, 'error')
    return Response.json({ status: 'deleted', subject: 'account-a' })
  })
  await h.demo.status(); await h.demo.deleteCopy('account-a')
  await h.demo.setConsent('account-a', true); await h.demo.deleteCopy('account-a')
  assert.equal(h.sends(), 0)
  await h.demo.setDeleteConsent('account-a', true)
  const result = await h.demo.deleteCopy('account-a')
  assert.match(result.result || '', /Deleted the synthetic cloud copy for account-a@example.test \(account-a\)/)
  assert.equal(result.deleteConsent, false)
  await h.demo.deleteCopy('account-a'); assert.equal(h.sends(), 1)
})

test('delete confirmation cannot authorize creation or survive reconnect and OFF', async () => {
  const h = harness()
  await h.demo.setDeleteConsent('account-a', true); await h.demo.upload('account-a')
  assert.equal(h.sends(), 0)
  for (const enabled of [false, true]) {
    await h.demo.connect(true); await h.demo.setDeleteConsent('account-a', true)
    await h.demo.connect(enabled); await h.demo.deleteCopy('account-a')
    assert.equal(h.sends(), 0)
  }
})

test('replacement account or credential invalidates destructive confirmation', async () => {
  for (const value of [credential('account-b'), { ...credential(), tokens: { ...credential().tokens, accessToken: 'replacement' } }, { ...credential(), tokens: { ...credential().tokens, expiresAt: Date.now() - 1 } }, null]) {
    const h = harness(); await h.demo.setDeleteConsent('account-a', true)
    h.switch(value); await h.demo.deleteCopy('account-a')
    assert.equal(h.sends(), 0)
  }
})

test('OFF during delete credential lookup prevents any request', async () => {
  const h = harness(); await h.demo.setDeleteConsent('account-a', true)
  let release!: (value: CloudCredential) => void
  h.auth.credential = () => new Promise(resolve => { release = resolve })
  const pending = h.demo.deleteCopy('account-a')
  await h.demo.connect(false); release(credential()); await pending
  assert.equal(h.sends(), 0)
})

test('lost delete acknowledgment is uncertain and needs new confirmation to retry', async () => {
  const h = harness(async () => { throw new Error('secret') })
  await h.demo.setDeleteConsent('account-a', true)
  const result = await h.demo.deleteCopy('account-a')
  assert.match(result.result || '', /No acknowledgment/); assert.doesNotMatch(result.result || '', /secret/)
  await h.demo.deleteCopy('account-a'); assert.equal(h.sends(), 1)
  await h.demo.setDeleteConsent('account-a', true); await h.demo.deleteCopy('account-a')
  assert.equal(h.sends(), 2)
})

test('account switch during delete request cannot display stale success', async () => {
  let release!: (response: Response) => void
  let sent!: () => void
  const started = new Promise<void>(resolve => { sent = resolve })
  const h = harness(async () => { sent(); return new Promise(resolve => { release = resolve }) })
  await h.demo.setDeleteConsent('account-a', true)
  const pending = h.demo.deleteCopy('account-a'); await started
  h.switch(credential('account-b'))
  release(Response.json({ status: 'deleted', subject: 'account-a' }))
  assert.match((await pending).result || '', /No acknowledgment/)
  assert.equal(h.sends(), 1)
})

test('late delete consent lookup cannot bind after OFF', async () => {
  const h = harness()
  let release!: (value: CloudCredential) => void
  h.auth.credential = () => new Promise(resolve => { release = resolve })
  const pending = h.demo.setDeleteConsent('account-a', true)
  await h.demo.connect(false); release(credential())
  assert.equal((await pending).deleteConsent, false)
  assert.equal(h.sends(), 0)
})

test('OFF after delete send leaves uncertainty, not stale success', async () => {
  let release!: (response: Response) => void
  let sent!: () => void
  const started = new Promise<void>(resolve => { sent = resolve })
  const h = harness(async () => { sent(); return new Promise(resolve => { release = resolve }) })
  await h.demo.setDeleteConsent('account-a', true)
  const pending = h.demo.deleteCopy('account-a'); await started
  await h.demo.connect(false)
  release(Response.json({ status: 'deleted', subject: 'account-a' }))
  const result = await pending
  assert.match(result.result || '', /may already have accepted/)
  assert.doesNotMatch(result.result || '', /^Deleted/)
  assert.equal(result.deleteConsent, false); assert.equal(result.account.enabled, false)
})
