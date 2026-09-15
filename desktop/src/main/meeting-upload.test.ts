import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { harness, credential, accepted, meetingItem, MEETING, OTHER, type Harness } from './meeting-upload-harness.ts'
import type { MeetingListItem } from '../shared/contracts'

const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']

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

test('every write registers once and carries a device signature', async () => {
  const h = harness()
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  await h.upload.sync()
  await h.upload.enqueue(OTHER)
  await h.upload.sync()
  assert.equal(h.registrations.length, 1, 'registration happens once per credential')
  assert.match(h.registrations[0], /"public_key":"[A-Za-z0-9+/]+"/)
  for (const request of h.requests) {
    assert.equal(request.device?.length, 64)
    assert.ok((request.signature || '').length > 0, 'every write is signed')
  }
})

test('a Mac that cannot register sends nothing', async () => {
  const h = harness({ deviceStatus: 403 })
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  const status = await h.upload.sync()
  assert.equal(h.sends(), 0)
  assert.equal(h.registrations.length, 1)
  assert.match(status.result || '', /could not register/)
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

test('turning sync on backfills the Meetings that already exist on this Mac', async () => {
  const h = harness({ meetings: [meetingItem(MEETING), meetingItem(OTHER)] })
  const status = await h.upload.setConsent('user_a', true)
  assert.equal(h.sends(), 2)
  assert.equal(status.queue.pending, 0)
  assert.match(status.result || '', /Queued 2 existing Meetings for upload/)
})

test('one backfill sends more than a single pass of Meetings', async () => {
  const h = harness({ meetings: ids.map((id) => meetingItem(id)) })
  const status = await h.upload.setConsent('user_a', true)
  assert.equal(h.sends(), 7)
  assert.equal(status.queue.pending, 0)
})

test('a backfill stops when the server accepts nothing and keeps the rest queued', async () => {
  const h = harness({ meetings: ids.map((id) => meetingItem(id)), fetcher: async () => new Response('unavailable', { status: 503 }) })
  const status = await h.upload.setConsent('user_a', true)
  assert.equal(h.sends(), 1, 'a pass stops at the first missing acknowledgment')
  assert.equal(status.queue.pending, 7)
  assert.match(status.result || '', /7 still queued/)
})

test('a second enable does not upload an accepted Meeting again', async () => {
  const h = harness({ meetings: [meetingItem(MEETING)] })
  await h.upload.setConsent('user_a', true)
  await h.upload.setConsent('user_a', true)
  assert.equal(h.sends(), 1)
})

test('a Meeting whose document cannot be read is reported and does not block the rest', async () => {
  const h = harness({
    meetings: [meetingItem(MEETING), meetingItem(OTHER)],
    load: async (localId, revision) => localId === OTHER ? '' : `{"version":1,"revision":${revision}}`,
  })
  const status = await h.upload.setConsent('user_a', true)
  assert.equal(h.sends(), 1)
  assert.equal(status.queue.pending, 0)
  assert.match(status.result || '', /Queued 1 existing Meeting for upload/)
  assert.match(status.result || '', /1 could not be read yet/)
})

test('nothing is queued when this Mac has no Meetings yet', async () => {
  const status = await harness({ meetings: [] }).upload.setConsent('user_a', true)
  assert.equal(status.queue.entries.length, 0)
  assert.equal(status.result, null)
})

test('a record that finishes later queues and sends itself', async () => {
  const meetings: MeetingListItem[] = []
  const h = harness({ meetings })
  await h.upload.setConsent('user_a', true)
  assert.equal(h.sends(), 0)
  meetings.push(meetingItem(MEETING))
  await h.upload.syncNew()
  assert.equal(h.sends(), 1)
  assert.match((await h.upload.status()).result || '', /Uploaded a Meeting copy/)
  await h.upload.syncNew()
  assert.equal(h.sends(), 1, 'an accepted Meeting is not sent a second time')
})

test('a Meeting still recording or still processing never joins the queue', async () => {
  const h = harness({ meetings: [meetingItem(MEETING, 'recording'), meetingItem(OTHER, 'processing'), meetingItem('m3', 'pending'), meetingItem('m4', 'failed')] })
  await h.upload.setConsent('user_a', true)
  await h.upload.syncNew()
  assert.equal(h.sends(), 0)
  assert.equal((await h.upload.status()).queue.entries.length, 0)
})

test('the automatic path queues nothing without consent', async () => {
  const h = harness({ meetings: [meetingItem(MEETING)] })
  await h.upload.syncNew()
  assert.equal(h.sends(), 0)
  assert.equal((await h.upload.status()).queue.entries.length, 0)
})

test('the automatic path sends nothing the server already accepted', async () => {
  const meetings: MeetingListItem[] = [meetingItem(MEETING)]
  const h = harness({ meetings })
  await h.upload.setConsent('user_a', true)
  await h.upload.syncNew()
  assert.equal(h.sends(), 1)
})
