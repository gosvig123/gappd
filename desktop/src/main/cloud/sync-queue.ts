import { createHash } from 'node:crypto'
import type { MeetingSyncDocument, MeetingSyncEntry, MeetingSyncStatus, MeetingSyncWork } from '../../shared/meeting-sync-contract'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { MAX_SYNC_ATTEMPTS, emptyMeetingSyncDocument, validatedMeetingSyncDocument } from '../../shared/meeting-sync-contract.ts'
import type { SecureJsonStore } from '../secure-json-store'

/**
 * Owns the durable one-way upload queue.
 *
 * It stores work only; it never authenticates, sends or reads a Meeting itself. The
 * revision is assigned here, so two edits can never be sent out of order and a later
 * local edit cannot reuse an already accepted revision. A superseding edit replaces the
 * older pending entry, because only the newest complete document matters.
 */
export class MeetingSyncQueue {
  private readonly store: SecureJsonStore<MeetingSyncDocument>
  private readonly clock: () => Date
  private document: MeetingSyncDocument | null = null
  private heldBack = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(store: SecureJsonStore<MeetingSyncDocument>, clock: () => Date = () => new Date()) {
    this.store = store
    this.clock = clock
  }

  /**
   * Queues one Meeting and returns its assigned entry. The loader receives the revision, so
   * the document always carries the revision the queue will send it with. A loader failure
   * queues nothing.
   */
  enqueue(localId: string, load: (revision: number) => Promise<string | { document: string; stamp?: string }>): Promise<MeetingSyncEntry> {
    return this.serialize(async () => {
      const state = await this.load()
      await this.queueOne(state, localId, load)
      this.heldBack.delete(localId)
      await this.persist(state)
      return entryOf(localId, state)
    })
  }

  /**
   * Makes this queue belong to one account. Memory never crosses accounts: a second account drops
   * the first account's watermark and its queued work, because neither was ever accepted for it.
   * It also drops the first account's pending deletions: another account cannot delete those
   * copies, and they expire on their own.
   */
  claim(subject: string): Promise<void> {
    return this.serialize(async () => {
      if (typeof subject !== 'string' || subject.length === 0) throw new Error('A cloud account is required.')
      const state = await this.load()
      if (state.subject === subject) return
      if (state.subject !== null) {
        state.accepted = {}
        state.acceptedContent = {}
        state.acceptedStamp = {}
        state.deletions = []
        state.entries = {}
        this.heldBack.clear()
      }
      state.subject = subject
      await this.persist(state)
    })
  }

  /**
   * Queues new or changed Meeting text. Unchanged pending work keeps its revision and retry
   * count; failed work requires a manual retry. Meetings whose source stamp matches what was
   * already accepted or queued skip calling `load`. Only the stamp returned by `load` itself
   * (from the exact exported snapshot) is persisted, never the pre-export discovery stamp.
   * Whole batches run under one lock, and an unreadable Meeting does not block the rest.
   */
  backfill(
    items: Array<string | { localId: string; stamp?: string }>,
    load: (localId: string, revision: number) => Promise<string | { document: string; stamp?: string }>,
  ): Promise<{ queued: number; unreadable: number }> {
    return this.serialize(async () => {
      const state = await this.load()
      let queued = 0
      let unreadable = 0
      const nextHeldBack = new Set<string>()
      let dirty = false
      for (const item of items) {
        const localId = typeof item === 'string' ? item : item.localId
        const hintStamp = typeof item === 'string' ? undefined : item.stamp
        const entry = state.entries[localId]
        if (entry?.state === 'failed' || state.deletions.includes(localId)) continue
        if (hintStamp && this.isStampCurrent(state, localId, hintStamp, entry)) continue
        try {
          const loaded = await load(localId, nextRevision(state, localId))
          const document = typeof loaded === 'string' ? loaded : loaded.document
          const exportedStamp = typeof loaded === 'string' ? undefined : loaded.stamp
          if (!document) throw new Error('The Meeting document is unavailable.')
          const previous = entry ? contentHash(entry.document) : state.acceptedContent[localId]
          if (contentHash(document) === previous) {
            if (exportedStamp && this.recordStamp(state, localId, exportedStamp, entry)) dirty = true
            continue
          }
          await this.queueOne(state, localId, async () => document, exportedStamp)
          queued += 1
        } catch {
          unreadable += 1
          if (entry?.state === 'pending') nextHeldBack.add(localId)
        }
      }
      this.heldBack = nextHeldBack
      if (queued > 0 || dirty) await this.persist(state)
      return { queued, unreadable }
    })
  }

  /**
   * Records that a local Meeting is being deleted. A Meeting this queue has queued or seen accepted
   * may have a cloud copy, so its pending upload is dropped and a deletion waits for the next sync.
   * Nothing is written for a Meeting the queue never knew, so a Mac that never synced stays as it is.
   */
  forget(localId: string): Promise<void> {
    return this.serialize(async () => {
      if (typeof localId !== 'string' || localId.length === 0) throw new Error('A Meeting is required.')
      const state = await this.load()
      if (state.accepted[localId] === undefined && !state.entries[localId]) return
      delete state.entries[localId]
      this.heldBack.delete(localId)
      if (!state.deletions.includes(localId)) state.deletions.push(localId)
      await this.persist(state)
    })
  }

  /** The deletions to send for this account. Another account's queue has none for it. */
  deletionsFor(subject: string): Promise<string[]> {
    return this.serialize(async () => {
      const state = await this.load()
      return state.subject === subject ? [...state.deletions] : []
    })
  }

  /** Records that the server deleted the cloud copy, so nothing about that Meeting remains. */
  deleted(localId: string): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load()
      state.deletions = state.deletions.filter((candidate) => candidate !== localId)
      delete state.accepted[localId]
      delete state.acceptedContent[localId]
      delete state.acceptedStamp[localId]
      await this.persist(state)
    })
  }

  /** Returns the oldest eligible pending work without changing its state. */
  pending(options?: { requireStamp?: boolean }): Promise<MeetingSyncWork | null> {
    return this.serialize(async () => {
      const state = await this.load()
      for (const localId of Object.keys(state.entries).sort()) {
        if (this.heldBack.has(localId)) continue
        const stored = state.entries[localId]
        if (stored.state !== 'pending') continue
        if (options?.requireStamp && !stored.stamp) continue
        return { localId, ...stored }
      }
      return null
    })
  }

  /**
   * Records an accepted revision. Work that a newer enqueue already replaced is left alone,
   * so a late acknowledgment cannot delete newer pending work.
   */
  succeed(localId: string, revision: number): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load()
      state.accepted[localId] = Math.max(state.accepted[localId] ?? 0, revision)
      const entry = state.entries[localId]
      if (entry?.revision === revision) {
        state.acceptedContent[localId] = contentHash(entry.document)
        if (entry.stamp) state.acceptedStamp[localId] = entry.stamp
        else delete state.acceptedStamp[localId]
        delete state.entries[localId]
      }
      await this.persist(state)
    })
  }

  /** Records one failed attempt. The entry stops retrying after MAX_SYNC_ATTEMPTS. */
  fail(localId: string, revision: number, message: string): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load()
      const stored = state.entries[localId]
      if (!stored || stored.revision !== revision) return
      stored.attempts += 1
      stored.updatedAt = this.timestamp()
      stored.error = message
      if (stored.attempts >= MAX_SYNC_ATTEMPTS) stored.state = 'failed'
      await this.persist(state)
    })
  }

  /**
   * Drops every queued entry. An account-wide deletion bars the identities those entries belong
   * to, so keeping them would only queue work that can never succeed. Accepted revisions stay.
   */
  clear(): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load()
      state.entries = {}
      this.heldBack.clear()
      await this.persist(state)
    })
  }

  /**
   * Marks one revision as permanently unacceptable. A document the server refuses for its
   * own content will never become acceptable, so it must not consume retries.
   */
  reject(localId: string, revision: number, message: string): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load()
      const stored = state.entries[localId]
      if (!stored || stored.revision !== revision || stored.state === 'failed') return
      stored.state = 'failed'
      stored.error = message
      stored.updatedAt = this.timestamp()
      await this.persist(state)
    })
  }

  /** Returns the per-Meeting queue state, newest first. It never returns document text. */
  status(): Promise<MeetingSyncStatus> {
    return this.serialize(async () => {
      const state = await this.load()
      const entries = Object.keys(state.entries).sort().map((localId) => entryOf(localId, state))
      return {
        pending: entries.filter((entry) => entry.state === 'pending').length,
        failed: entries.filter((entry) => entry.state === 'failed').length,
        deleting: state.deletions.length,
        entries,
      }
    })
  }

  private isStampCurrent(state: MeetingSyncDocument, localId: string, stamp: string, entry: MeetingSyncDocument['entries'][string] | undefined): boolean {
    if (entry) return entry.stamp === stamp
    return state.accepted[localId] !== undefined && state.acceptedContent[localId] !== undefined && state.acceptedStamp[localId] === stamp
  }

  private recordStamp(state: MeetingSyncDocument, localId: string, stamp: string, entry: MeetingSyncDocument['entries'][string] | undefined): boolean {
    if (entry) {
      if (entry.stamp === stamp) return false
      entry.stamp = stamp
      return true
    }
    if (state.accepted[localId] === undefined || state.acceptedStamp[localId] === stamp) return false
    state.acceptedStamp[localId] = stamp
    return true
  }

  private async queueOne(state: MeetingSyncDocument, localId: string, load: (revision: number) => Promise<string | { document: string; stamp?: string }>, stamp?: string): Promise<void> {
    if (typeof localId !== 'string' || localId.length === 0 || typeof load !== 'function') {
      throw new Error('A Meeting and a document loader are required.')
    }
    const revision = nextRevision(state, localId)
    const loaded = await load(revision)
    const document = typeof loaded === 'string' ? loaded : loaded.document
    const resolvedStamp = stamp ?? (typeof loaded === 'string' ? undefined : loaded.stamp)
    if (typeof document !== 'string' || document.length === 0) throw new Error('The Meeting document is unavailable.')
    state.entries[localId] = { revision, document, state: 'pending', attempts: 0, updatedAt: this.timestamp(), error: null, ...(resolvedStamp ? { stamp: resolvedStamp } : {}) }
  }

  private async load(): Promise<MeetingSyncDocument> {
    if (this.document) return this.document
    const stored = await this.store.read()
    this.document = stored === null ? emptyMeetingSyncDocument() : requireDocument(stored)
    return this.document
  }

  private async persist(state: MeetingSyncDocument): Promise<void> {
    await this.store.write(state)
  }

  private timestamp(): string {
    return this.clock().toISOString()
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }
}

function contentHash(document: string): string {
  // The producer emits stable JSON; revision alone is not a content change.
  try { document = JSON.stringify({ ...JSON.parse(document), revision: 0 }) } catch { /* Preserve opaque queued bytes. */ }
  return createHash('sha256').update(document).digest('hex')
}

function requireDocument(stored: unknown): MeetingSyncDocument {
  const document = validatedMeetingSyncDocument(stored)
  if (!document) throw new Error('Queued uploads could not be read because the local file has unsupported or damaged records. Nothing was sent.')
  return document
}

// The revision never repeats or goes backwards, even across restarts.
function nextRevision(state: MeetingSyncDocument, localId: string): number {
  const highest = Math.max(state.accepted[localId] ?? 0, state.entries[localId]?.revision ?? 0)
  return highest + 1
}

function entryOf(localId: string, state: MeetingSyncDocument): MeetingSyncEntry {
  const stored = state.entries[localId]
  return {
    localId, revision: stored.revision, state: stored.state, attempts: stored.attempts,
    updatedAt: stored.updatedAt, error: stored.error,
  }
}
