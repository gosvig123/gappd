import type { MeetingSyncDocument, MeetingSyncEntry, MeetingSyncStatus, MeetingSyncWork } from '../shared/meeting-sync-contract'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { MAX_SYNC_ATTEMPTS, emptyMeetingSyncDocument, validatedMeetingSyncDocument } from '../shared/meeting-sync-contract.ts'
import type { SecureJsonStore } from './secure-json-store'

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
  enqueue(localId: string, load: (revision: number) => Promise<string>): Promise<MeetingSyncEntry> {
    return this.serialize(async () => {
      const state = await this.load()
      await this.queueOne(state, localId, load)
      await this.persist(state)
      return entryOf(localId, state)
    })
  }

  /**
   * Queues every local Meeting the server has not accepted yet, so turning sync on uploads the
   * Meetings that already exist. Whole batches run under one lock, and a Meeting whose document
   * cannot be read is skipped rather than left to fail the rest.
   */
  backfill(localIds: string[], load: (localId: string, revision: number) => Promise<string>): Promise<{ queued: number; unreadable: number }> {
    return this.serialize(async () => {
      const state = await this.load()
      let queued = 0
      let unreadable = 0
      for (const localId of localIds) {
        if (state.accepted[localId] !== undefined || state.entries[localId] !== undefined) continue
        try {
          await this.queueOne(state, localId, (revision) => load(localId, revision))
          queued += 1
        } catch {
          unreadable += 1
        }
      }
      if (queued > 0) await this.persist(state)
      return { queued, unreadable }
    })
  }

  /** Returns the oldest pending work without changing its state. */
  pending(): Promise<MeetingSyncWork | null> {
    return this.serialize(async () => {
      const state = await this.load()
      for (const localId of Object.keys(state.entries).sort()) {
        const stored = state.entries[localId]
        if (stored.state === 'pending') return { localId, ...stored }
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
      if (state.entries[localId]?.revision === revision) delete state.entries[localId]
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
        entries,
      }
    })
  }

  private async queueOne(state: MeetingSyncDocument, localId: string, load: (revision: number) => Promise<string>): Promise<void> {
    if (typeof localId !== 'string' || localId.length === 0 || typeof load !== 'function') {
      throw new Error('A Meeting and a document loader are required.')
    }
    const revision = nextRevision(state, localId)
    const document = await load(revision)
    if (typeof document !== 'string' || document.length === 0) throw new Error('The Meeting document is unavailable.')
    state.entries[localId] = { revision, document, state: 'pending', attempts: 0, updatedAt: this.timestamp(), error: null }
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
