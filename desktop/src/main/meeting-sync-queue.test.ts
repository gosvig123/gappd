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

test('enqueue assigns increasing revisions and replaces the older pending copy', async () => {
  const { queue: sync } = queue()
  assert.equal((await sync.enqueue(MEETING, '{"version":1,"revision":1}')).revision, 1)
  const second = await sync.enqueue(MEETING, '{"version":1,"revision":2}')
  assert.equal(second.revision, 2)
  const status = await sync.status()
  assert.equal(status.entries.length, 1)
  assert.equal(status.pending, 1)
  assert.equal((await sync.pending())?.document, '{"version":1,"revision":2}')
})

test('a queued revision never repeats, even after the entry is accepted', async () => {
  const { queue: sync } = queue()
  const first = await sync.enqueue(MEETING, 'first')
  await sync.succeed(MEETING, first.revision)
  assert.equal((await sync.status()).entries.length, 0)
  const again = await sync.enqueue(MEETING, 'second')
  assert.equal(again.revision, 2)
  assert.equal(await sync.pending().then((work) => work?.document), 'second')
})

test('a late acknowledgment cannot delete newer pending work', async () => {
  const { queue: sync } = queue()
  const first = await sync.enqueue(MEETING, 'first')
  await sync.enqueue(MEETING, 'second')
  await sync.succeed(MEETING, first.revision)
  assert.equal((await sync.pending())?.document, 'second')
  assert.equal((await sync.status()).entries[0].revision, 2)
})

test('retry attempts are bounded and then reported as failed', async () => {
  const { queue: sync } = queue()
  const entry = await sync.enqueue(MEETING, 'document')
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
  const first = await sync.enqueue(MEETING, 'first')
  await sync.enqueue(MEETING, 'second')
  await sync.fail(MEETING, first.revision, 'late failure')
  const entry = (await sync.status()).entries[0]
  assert.equal(entry.revision, 2)
  assert.equal(entry.attempts, 0)
  assert.equal(entry.error, null)
})

test('queued work survives a restart and drains one Meeting at a time', async () => {
  const { store, queue: sync } = queue()
  await sync.enqueue(MEETING, 'durable')
  await sync.enqueue(OTHER, 'other')
  const restarted = new MeetingSyncQueue(store)
  assert.equal((await restarted.status()).pending, 2)
  // Sorted local ids, so the first Meeting cannot starve the second.
  const first = await restarted.pending()
  assert.equal(first?.localId, OTHER)
  await restarted.succeed(OTHER, first!.revision)
  assert.equal((await restarted.pending())?.document, 'durable')
  const next = await restarted.enqueue(MEETING, 'newer')
  assert.equal(next.revision, 2)
})

test('an invalid argument is refused and queues nothing', async () => {
  const { queue: sync } = queue()
  await assert.rejects(sync.enqueue('', 'document'))
  await assert.rejects(sync.enqueue(MEETING, ''))
  assert.equal((await sync.status()).entries.length, 0)
})

test('a damaged or unsupported queue file is refused whole', async () => {
  const { store, queue: sync } = queue()
  await sync.enqueue(MEETING, 'durable')
  const damaged = { ...store.stored, version: 99 }
  store.stored = damaged as MeetingSyncDocument
  await assert.rejects(new MeetingSyncQueue(store).status())
  store.stored = { version: 1, accepted: {}, entries: { [MEETING]: { revision: 0, document: 'x', state: 'pending', attempts: 0, updatedAt: '', error: null } } }
  await assert.rejects(new MeetingSyncQueue(store).status())
})

test('status never returns document text', async () => {
  const { queue: sync } = queue()
  await sync.enqueue(MEETING, 'secret transcript')
  const status = await sync.status()
  assert.equal(JSON.stringify(status).includes('secret transcript'), false)
  assert.equal(status.entries[0].localId, MEETING)
})
