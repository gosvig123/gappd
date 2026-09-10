import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { AgendaDraftStore } from './agenda-draft-store.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SecureJsonStore, type StoreCipher } from './secure-json-store.ts'
import type { AgendaDraftDocument, AgendaDraftRecord, SavedAgendaDraft } from '../shared/agenda-draft'

const cipher: StoreCipher = {
  encrypt: (value) => Buffer.from(Buffer.from(value).toString('base64url')),
  decrypt: (value) => Buffer.from(value.toString(), 'base64url').toString(),
}

class FakeStore extends SecureJsonStore<AgendaDraftDocument> {
  writes = 0
  failures = 0
  override async write(value: AgendaDraftDocument): Promise<void> {
    this.writes += 1
    if (this.failures > 0) {
      this.failures -= 1
      throw new Error('Secure local data could not be written.')
    }
    return super.write(value)
  }
}

const KEY = 'self@example.com:primary:event-1'

function record(overrides: Partial<AgendaDraftRecord> = {}): AgendaDraftRecord {
  return {
    draftKey: KEY, sourceId: 'connection:primary:event-1', title: 'Agenda', accountEmail: 'self@example.com',
    eventStart: '2026-09-10T10:00:00.000Z', eventEnd: '2026-09-10T11:00:00.000Z',
    items: [
      { topic: 'First topic', sourceId: 'meeting-1', quote: 'First evidence' },
      { topic: 'Second topic', sourceId: 'meeting-2', quote: 'Second evidence' },
    ],
    sources: [{ id: 'meeting-1', title: 'Meeting 1', startedAt: '2026-09-01T10:00:00.000Z' }],
    historyIncomplete: false, generatedAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
    model: 'gpt-5.6-terra', reasoningEffort: 'medium', revision: 1,
    ...overrides,
  }
}

async function fixture(fill?: (store: FakeStore) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gappd-agenda-drafts-'))
  const store = new FakeStore(path.join(directory, 'agenda-drafts.enc'), cipher)
  if (fill) await fill(store)
  return { store, drafts: new AgendaDraftStore(store, () => new Date('2026-09-11T12:00:00.000Z')), cleanup: () => rm(directory, { recursive: true, force: true }) }
}

test('topic saves keep stored source and quote metadata and bump the revision', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record()] }))
  try {
    const result = await f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['Edited first', 'Edited second'] })
    assert.equal(result.ok, true)
    assert.equal(result.durable, true)
    assert.equal(result.revision, 2)
    assert.equal(result.current?.updatedAt, '2026-09-11T12:00:00.000Z')
    assert.deepEqual(result.current?.items, [
      { topic: 'Edited first', sourceId: 'meeting-1', quote: 'First evidence' },
      { topic: 'Edited second', sourceId: 'meeting-2', quote: 'Second evidence' },
    ])
    assert.equal((await f.store.read())?.drafts[0]?.items[0]?.topic, 'Edited first')
  } finally { await f.cleanup() }
})

test('topic counts that do not match the stored draft are rejected without a write', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record()] }))
  try {
    const before = f.store.writes
    const result = await f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['only one'] })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'invalid')
    assert.equal(f.store.writes, before)
    assert.equal((await f.drafts.load(KEY))?.items.length, 2)
  } finally { await f.cleanup() }
})

test('a stale revision conflicts and reports the stored version', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record()] }))
  try {
    const [first, second] = await Promise.all([
      f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['First edit', 'Second topic'] }),
      f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['Second edit', 'Second topic'] }),
    ])
    assert.equal([first, second].filter((result) => result.ok).length, 1)
    const conflicted = first.ok ? second : first
    assert.equal(conflicted.reason, 'conflict')
    assert.equal(conflicted.revision, 2)
    assert.equal(conflicted.conflict?.topics[0], first.ok ? 'First edit' : 'Second edit')
    assert.match(conflicted.error ?? '', /Reload the saved version/)
    const stored = await f.store.read()
    assert.equal(stored?.drafts.length, 1)
    assert.equal(stored?.drafts[0]?.revision, 2)
  } finally { await f.cleanup() }
})

test('a failed write is accepted with durable false and a retry persists it', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record()] }))
  try {
    f.store.failures = 1
    const failed = await f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['Kept in memory', 'Second topic'] })
    assert.equal(failed.ok, true)
    assert.equal(failed.durable, false)
    assert.equal(failed.revision, 2)
    assert.match(failed.error ?? '', /could not be written/)
    const pending = (await f.drafts.load(KEY)) as SavedAgendaDraft
    assert.equal(pending.durable, false)
    assert.equal(pending.items[0]?.topic, 'Kept in memory')
    const retry = await f.drafts.saveTopics({ draftKey: KEY, expectedRevision: failed.revision, topics: ['Kept in memory', 'Second topic'] })
    assert.equal(retry.ok, true)
    assert.equal(retry.durable, true)
    assert.equal(retry.revision, 2)
    assert.equal((await f.store.read())?.drafts[0]?.items[0]?.topic, 'Kept in memory')
    assert.equal((await f.drafts.list())[0]?.durable, true)
  } finally { await f.cleanup() }
})

test('generation replaces topics only at the expected revision', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record()] }))
  try {
    const stale = await f.drafts.saveGenerated(record({ items: [{ topic: 'Generated', sourceId: 'meeting-1', quote: 'First evidence' }] }), 0)
    assert.equal(stale.ok, false)
    assert.equal(stale.reason, 'conflict')
    assert.equal((await f.drafts.load(KEY))?.items[0]?.topic, 'First topic')
    const applied = await f.drafts.saveGenerated(record({ items: [{ topic: 'Generated', sourceId: 'meeting-1', quote: 'First evidence' }] }), 1)
    assert.equal(applied.ok, true)
    assert.equal(applied.revision, 2)
    assert.equal((await f.drafts.load(KEY))?.items[0]?.topic, 'Generated')
  } finally { await f.cleanup() }
})

test('a generated draft for an unknown key needs revision zero and respects the local limit', async () => {
  const full: AgendaDraftDocument = { version: 2, drafts: Array.from({ length: 100 }, (_, index) => record({ draftKey: `k-${index}`, sourceId: `s-${index}` })) }
  const f = await fixture(async (store) => store.write(full))
  try {
    const limited = await f.drafts.saveGenerated(record({ draftKey: 'new-key', sourceId: 'new-source' }), 0)
    assert.equal(limited.ok, false)
    assert.equal(limited.reason, 'limit')
    assert.equal((await f.drafts.list()).length, 100)
    assert.equal(await f.drafts.load('new-key'), null)
    const vanished = await f.drafts.saveGenerated(record({ draftKey: 'gone', sourceId: 'gone' }), 3)
    assert.equal(vanished.reason, 'conflict')
  } finally { await f.cleanup() }
})

test('legacy connection-keyed records migrate to the stable account key', async () => {
  const legacy = { ...record(), draftKey: undefined, sourceId: 'a1468348-0d3c:primary:event-1' } as unknown as AgendaDraftRecord
  const f = await fixture(async (store) => store.write({ version: 1, drafts: [legacy] }))
  try {
    const listed = await f.drafts.list()
    assert.deepEqual(listed.map((draft) => draft.draftKey), ['self@example.com:primary:event-1'])
    const saved = await f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['Migrated', 'Second topic'] })
    assert.equal(saved.ok, true)
    assert.equal(saved.revision, 2)
    const stored = await f.store.read()
    assert.equal(stored?.version, 2)
    assert.equal(stored?.drafts[0]?.draftKey, KEY)
  } finally { await f.cleanup() }
})

test('duplicate normalized and migrated draft keys fail closed without writes', async () => {
  const legacy = { ...record(), draftKey: undefined, sourceId: 'connection:primary:event-1' } as unknown as AgendaDraftRecord
  const duplicate = record({ draftKey: 'SELF@EXAMPLE.COM:primary:event-1', sourceId: 'different-source' })
  const f = await fixture(async (store) => store.write({ version: 1, drafts: [legacy, duplicate] }))
  try {
    const before = f.store.writes
    await assert.rejects(() => f.drafts.list(), /damaged/)
    await assert.rejects(() => f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['a', 'b'] }), /damaged/)
    assert.equal(f.store.writes, before)
    assert.equal((await f.store.read())?.drafts.length, 2)
  } finally { await f.cleanup() }
})

test('one damaged record makes the document fail closed without deletion or writes', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record(), { draftKey: 5 } as never] }))
  try {
    await assert.rejects(() => f.drafts.list(), /damaged/)
    const before = f.store.writes
    await assert.rejects(() => f.drafts.saveTopics({ draftKey: KEY, expectedRevision: 1, topics: ['a', 'b'] }), /damaged/)
    await assert.rejects(() => f.drafts.saveGenerated(record({ draftKey: 'x', sourceId: 'x' }), 0), /damaged/)
    assert.equal(f.store.writes, before)
    const stored = await f.store.read()
    assert.equal(stored?.drafts.length, 2)
  } finally { await f.cleanup() }
})

test('removal is explicit, reported, and restored when the write fails', async () => {
  const f = await fixture(async (store) => store.write({ version: 2, drafts: [record()] }))
  try {
    f.store.failures = 1
    const failed = await f.drafts.remove(KEY)
    assert.equal(failed.removed, false)
    assert.match(failed.error ?? '', /could not be written/)
    assert.equal((await f.drafts.load(KEY))?.revision, 1)
    const removed = await f.drafts.remove(KEY)
    assert.equal(removed.removed, true)
    assert.equal(await f.drafts.load(KEY), null)
    assert.equal((await f.store.read())?.drafts.length, 0)
  } finally { await f.cleanup() }
})

test('an unreadable file is reported without writing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gappd-agenda-drafts-'))
  const file = path.join(directory, 'agenda-drafts.enc')
  const store = new FakeStore(file, cipher)
  const drafts = new AgendaDraftStore(store)
  try {
    await writeFile(file, Buffer.from('not encrypted'), { mode: 0o600 })
    await assert.rejects(() => drafts.list(), /could not be read/)
    assert.equal(store.writes, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
