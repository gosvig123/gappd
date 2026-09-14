import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { harness, accepted, MEETING } from './meeting-upload-harness.ts'

test('erasing every copy needs its own confirmation and clears the queue', async () => {
  const calls: string[] = []
  const h = harness({ fetcher: async (input) => {
    calls.push(String(input))
    return input.toString().endsWith('/delete-all')
      ? Response.json({ status: 'deleted', subject: 'user_a', removed: 3 })
      : accepted(1)
  } })
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  assert.equal((await h.upload.status()).accountDeleteConsent, false)
  assert.equal((await h.upload.status()).queue.pending, 1)
  // A confirmation issued for another account is not consumed by this call.
  await h.upload.setAccountDeleteConsent('someone_else', true)
  await h.upload.deleteAll()
  assert.equal(h.sends(), 0, 'another account confirmation must not erase this account')
  await h.upload.setAccountDeleteConsent('user_a', true)
  const status = await h.upload.deleteAll()
  assert.equal(calls.filter((url) => url.endsWith('/delete-all')).length, 1)
  assert.match(status.result || '', /Deleted 3 cloud copies/)
  assert.equal(status.queue.pending, 0, 'barred identities must not stay queued')
  assert.equal(status.accountDeleteConsent, false, 'the confirmation is used once')
})

test('allowing uploads again remembers the generation and signs with it', async () => {
  const h = harness({ fetcher: async (input) => input.toString().endsWith('/consent')
    ? Response.json({ status: 'allowed', subject: 'user_a', generation: 5 })
    : accepted(1) })
  await h.upload.setConsent('user_a', true)
  const status = await h.upload.allowUploads()
  assert.match(status.result || '', /generation 5/)
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  const upload = h.requests.find((request) => request.url.endsWith('/meeting'))
  assert.equal(upload?.generation, '5', 'a later write presents the issued generation')
})

test('revoking a client needs a confirmation naming that client', async () => {
  const bodies: string[] = []
  const h = harness({ fetcher: async (_input, init) => {
    bodies.push(String(init?.body))
    return Response.json({ status: 'revoked', subject: 'user_a' })
  } })
  await h.upload.setConsent('user_a', true)
  await h.upload.setRevokeConsent('user_a', true, 'pi')
  await h.upload.revokeClient('user_a', 'someone-else')
  assert.equal(h.sends(), 0, 'a confirmation for another client must not be consumed')
  const status = await h.upload.revokeClient('user_a', 'pi')
  assert.deepEqual(JSON.parse(bodies[0] || '{}'), { client_id: 'pi' })
  assert.match(status.result || '', /Revoked pi/)
  assert.equal(status.revokeConsent, false)
})

test('a lost acknowledgment for an account action is reported as uncertain', async () => {
  const h = harness({ fetcher: async () => new Response('unavailable', { status: 503 }) })
  await h.upload.setConsent('user_a', true)
  await h.upload.setAccountDeleteConsent('user_a', true)
  const status = await h.upload.deleteAll()
  assert.match(status.result || '', /may already have acted/)
})

test('the account actions need consent and a registered device', async () => {
  const h = harness({ deviceStatus: 403 })
  await h.upload.setConsent('user_a', true)
  assert.equal((await h.upload.allowUploads()).result?.includes('could not register'), true)
})
