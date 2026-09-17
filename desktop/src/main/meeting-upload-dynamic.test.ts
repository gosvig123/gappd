import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { harness, accepted, meetingItem, MEETING, credential } from './meeting-upload-harness.ts'

async function settled(check: () => Promise<boolean>): Promise<void> {
  for (let n = 0; n < 100; n++) {
    if (await check()) return
    await setImmediate()
  }
  assert.fail('Background sync did not settle')
}

test('automatic sync retries pending work without a new Meeting and stops at the retry limit', async () => {
  let online = false
  const h = harness({ meetings: [meetingItem(MEETING)], fetcher: async () => online ? accepted(1) : new Response(null, { status: 503 }) })
  await h.upload.setConsent('user_a', true)
  online = true
  await h.upload.syncNew()
  assert.equal(h.sends(), 2)
  assert.equal((await h.upload.status()).queue.pending, 0)
  const failed = harness({ meetings: [meetingItem(MEETING)], fetcher: async () => new Response(null, { status: 503 }) })
  await failed.upload.setConsent('user_a', true)
  for (let n = 0; n < 8; n++) await failed.upload.syncNew()
  assert.equal(failed.sends(), 5)
  assert.equal((await failed.upload.status()).queue.failed, 1)
  await h.upload.connect(false)
  await failed.upload.connect(false)
})

test('automatic sync sends edited text at a higher revision, but not unchanged text', async () => {
  let title = 'Original'
  const h = harness({ meetings: [meetingItem(MEETING)],
    load: async (_id, revision) => JSON.stringify({ version: 1, revision, title }),
    fetcher: async (_url, init) => accepted(JSON.parse(String(init?.body)).revision),
  })
  await h.upload.setConsent('user_a', true)
  await h.upload.syncNew()
  assert.equal(h.sends(), 1)
  title = 'Corrected'
  await h.upload.syncNew()
  assert.equal(h.sends(), 2)
  assert.deepEqual(JSON.parse(h.requests[1].body!), { version: 1, revision: 2, title })
  await h.upload.syncNew()
  assert.equal(h.sends(), 2)
  await h.upload.connect(false)
})

test('background sync discovers Meetings without a processing event, and stops when consent is removed', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const meetings = [] as ReturnType<typeof meetingItem>[]
  const h = harness({ meetings })
  await h.upload.setConsent('user_a', true)
  meetings.push(meetingItem(MEETING))
  t.mock.timers.tick(60_000)
  await settled(async () => h.sends() === 1 && !(await h.upload.status()).sending)
  await h.upload.setConsent('user_a', false)
  meetings.push(meetingItem('another'))
  t.mock.timers.tick(120_000)
  await setImmediate()
  assert.equal(h.sends(), 1)
  assert.equal((await h.upload.status()).queue.pending, 0)
})

test('overlapping automatic requests send a Meeting only once', async () => {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const meetings = [] as ReturnType<typeof meetingItem>[]
  const h = harness({ meetings, load: async (_id, revision) => { entered(); await gate; return JSON.stringify({ version: 1, revision }) } })
  await h.upload.setConsent('user_a', true)
  meetings.push(meetingItem(MEETING))
  const first = h.upload.syncNew()
  await started
  const second = h.upload.syncNew()
  release()
  await Promise.all([first, second])
  assert.equal(h.sends(), 1)
  await h.upload.connect(false)
})

test('concurrent send requests share one upload, and OFF during credential lookup prevents a send', async () => {
  const h = harness()
  await h.upload.setConsent('user_a', true)
  await h.upload.enqueue(MEETING)
  await Promise.all([h.upload.sync(), h.upload.sync()])
  assert.equal(h.sends(), 1)
  await h.upload.enqueue(MEETING)
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  h.auth.credential = async () => { entered(); await gate; return credential() }
  const sending = h.upload.sync()
  await started
  await h.upload.connect(false)
  release()
  await sending
  assert.equal(h.sends(), 1)
})

test('turning sync off during discovery prevents upload; another account needs fresh consent', async () => {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const meetings = [] as ReturnType<typeof meetingItem>[]
  const h = harness({ meetings, load: async (_id, revision) => { entered(); await gate; return JSON.stringify({ version: 1, revision }) } })
  await h.upload.setConsent('user_a', true)
  meetings.push(meetingItem(MEETING))
  const flight = h.upload.syncNew()
  await started
  const off = h.upload.connect(false)
  release()
  await Promise.all([flight, off])
  assert.equal(h.sends(), 0)
  h.switch(credential('user_b'))
  await h.upload.syncNew()
  assert.equal(h.sends(), 0)
  await h.upload.setConsent('user_b', true)
  assert.equal(h.sends(), 1)
  assert.equal(h.requests[0].authorization, 'Bearer token-user_b')
  await h.upload.connect(false)
})
