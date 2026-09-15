import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingSyncQueue } from './meeting-sync-queue.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SecureJsonStore, type StoreCipher } from './secure-json-store.ts'
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

function queue(clock?: () => Date) {
  const store = new FakeStore('/tmp/unused.enc', cipher)
  return { store, queue: new MeetingSyncQueue(store, clock) }
}

test('claiming a queue for another account drops the watermark and the queued work', async () => {
  const { store, queue: sync } = queue()
  await sync.claim('user_a')
  await sync.enqueue(MEETING, async () => '{"version":1,"revision":1}')
  await sync.succeed(MEETING, 1)
  assert.equal(store.stored?.accepted[MEETING], 1)
  await sync.claim('user_a')
  assert.equal(store.stored?.accepted[MEETING], 1, 'the same account keeps its watermark')
  await sync.claim('user_b')
  assert.deepEqual(store.stored?.accepted, {})
  assert.equal(store.stored?.subject, 'user_b')
  assert.equal((await sync.enqueue(MEETING, async () => '{"version":1,"revision":1}')).revision, 1)
})

test('a queue written before queues were owned is adopted, not wiped', async () => {
  const { store, queue: sync } = queue()
  // The shape a version-1 document on disk has: a watermark and no account.
  store.stored = { version: 1, accepted: { [MEETING]: 3 }, entries: {} } as unknown as MeetingSyncDocument
  await sync.claim('user_a')
  assert.equal(store.stored?.accepted[MEETING], 3, 'the only account this Mac has used keeps its history')
  assert.equal(store.stored?.subject, 'user_a')
})

test('enqueue assigns increasing revisions and replaces the older pending copy', async () => {
  const { queue: sync } = queue()
  assert.equal((await sync.enqueue(MEETING, async () => '{"version":1,"revision":1}')).revision, 1)
  const second = await sync.enqueue(MEETING, async () => '{"version":1,"revision":2}')
  assert.equal(second.revision, 2)
  const status = await sync.status()
  assert.equal(status.entries.length, 1)
  assert.equal(status.pending, 1)
  assert.equal((await sync.pending())?.document, '{"version":1,"revision":2}')
})

test('a queued revision never repeats, even after the entry is accepted', async () => {
  const { queue: sync } = queue()
  const first = await sync.enqueue(MEETING, async () => 'first')
  await sync.succeed(MEETING, first.revision)
  assert.equal((await sync.status()).entries.length, 0)
  const again = await sync.enqueue(MEETING, async () => 'second')
  assert.equal(again.revision, 2)
  assert.equal(await sync.pending().then((work) => work?.document), 'second')
})

test('a late acknowledgment cannot delete newer pending work', async () => {
  const { queue: sync } = queue()
  const first = await sync.enqueue(MEETING, async () => 'first')
  await sync.enqueue(MEETING, async () => 'second')
  await sync.succeed(MEETING, first.revision)
  assert.equal((await sync.pending())?.document, 'second')
  assert.equal((await sync.status()).entries[0].revision, 2)
})

test('retry attempts are bounded and then reported as failed', async () => {
  const { queue: sync } = queue()
  const entry = await sync.enqueue(MEETING, async () => 'document')
  for (let attempt = 1; attempt <= 4; attempt++) {
    await sync.fail(MEETING, entry.revision, 'no acknowledgment')
  }
  assert.equal((await sync.status()).pending, 1)
  assert.equal((await sync.status()).entries[0].attempts, 4)
  await sync.fail(MEETING, entry.revision, 'no acknowledgment')
  const status = await sync.status()
  assert.equal(status.pending, 0)
  assert.equal(status.failed, 1)
  assert.equal(status.entries[0].error, 'no acknowledgment')
})

test('a failure for a superseded revision is ignored', async () => {
  const { queue: sync } = queue()
  const first = await sync.enqueue(MEETING, async () => 'first')
  await sync.enqueue(MEETING, async () => 'second')
  await sync.fail(MEETING, first.revision, 'late failure')
  const entry = (await sync.status()).entries[0]
  assert.equal(entry.revision, 2)
  assert.equal(entry.attempts, 0)
  assert.equal(entry.error, null)
})

test('queued work survives a restart and drains one Meeting at a time', async () => {
  const { store, queue: sync } = queue()
  await sync.enqueue(MEETING, async () => 'durable')
  await sync.enqueue(OTHER, async () => 'other')
  const restarted = new MeetingSyncQueue(store)
  assert.equal((await restarted.status()).pending, 2)
  // Sorted local ids, so the first Meeting cannot starve the second.
  const first = await restarted.pending()
  assert.equal(first?.localId, OTHER)
  await restarted.succeed(OTHER, first!.revision)
  assert.equal((await restarted.pending())?.document, 'durable')
  const next = await restarted.enqueue(MEETING, async () => 'newer')
  assert.equal(next.revision, 2)
})

test('an invalid argument is refused and queues nothing', async () => {
  const { queue: sync } = queue()
  await assert.rejects(sync.enqueue('', async () => 'document'))
  await assert.rejects(sync.enqueue(MEETING, async () => ''))
  assert.equal((await sync.status()).entries.length, 0)
})

test('the loader receives the revision the queue will send', async () => {
  const { queue: sync } = queue()
  const seen: number[] = []
  const entry = await sync.enqueue(MEETING, async (revision) => { seen.push(revision); return 'document' })
  assert.deepEqual(seen, [entry.revision])
  const second = await sync.enqueue(MEETING, async (revision) => { seen.push(revision); return 'newer' })
  assert.deepEqual(seen, [1, second.revision])
})

test('a loader failure queues nothing', async () => {
  const { queue: sync } = queue()
  await assert.rejects(sync.enqueue(MEETING, async () => { throw new Error('Meeting document unavailable') }))
  assert.equal((await sync.status()).entries.length, 0)
})

test('a rejected revision stops retrying immediately', async () => {
  const { queue: sync } = queue()
  const entry = await sync.enqueue(MEETING, async () => 'document')
  await sync.reject(MEETING, entry.revision, 'The server refused this document.')
  const status = await sync.status()
  assert.equal(status.pending, 0)
  assert.equal(status.failed, 1)
  assert.equal(status.entries[0].attempts, 0)
  assert.equal(status.entries[0].error, 'The server refused this document.')
  await sync.reject(MEETING, entry.revision, 'late')
  assert.equal((await sync.status()).entries[0].error, 'The server refused this document.')
})

test('a damaged or unsupported queue file is refused whole', async () => {
  const { store, queue: sync } = queue()
  await sync.enqueue(MEETING, async () => 'durable')
  const damaged = { ...store.stored, version: 99 }
  store.stored = damaged as MeetingSyncDocument
  await assert.rejects(new MeetingSyncQueue(store).status())
  store.stored = { version: 1, subject: null, accepted: {}, entries: { [MEETING]: { revision: 0, document: 'x', state: 'pending', attempts: 0, updatedAt: '', error: null } } }
  await assert.rejects(new MeetingSyncQueue(store).status())
})

test('status never returns document text', async () => {
  const { queue: sync } = queue()
  await sync.enqueue(MEETING, async () => 'secret transcript')
  const status = await sync.status()
  assert.equal(JSON.stringify(status).includes('secret transcript'), false)
  assert.equal(status.entries[0].localId, MEETING)
})
