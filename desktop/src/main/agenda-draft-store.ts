import type {
  AgendaDraftConflict, AgendaDraftDocument, AgendaDraftRecord, AgendaDraftRemoveResult,
  AgendaDraftSaveInput, AgendaDraftWriteResult, SavedAgendaDraft,
} from '../shared/agenda-draft'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { MAX_SAVED_AGENDA_DRAFTS, SAVED_AGENDA_VERSION, applyAgendaTopics, agendaDraftTopics, topicsApplyTo, validatedAgendaTopics, validatedSavedAgendaDocument } from '../shared/agenda-draft.ts'
import type { SecureJsonStore } from './secure-json-store'

type Entry = { record: AgendaDraftRecord; durable: boolean }

/**
 * Owns locally saved Agenda drafts. Mutations are serialized, topic edits are
 * accepted only against the stored revision and item identity, and a change is
 * reported durable only after the encrypted document reached disk.
 */
export class AgendaDraftStore {
  private readonly store: SecureJsonStore<AgendaDraftDocument>
  private readonly clock: () => Date
  private document: AgendaDraftDocument | null = null
  private entries = new Map<string, Entry>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(store: SecureJsonStore<AgendaDraftDocument>, clock: () => Date = () => new Date()) {
    this.store = store
    this.clock = clock
  }

  list(): Promise<SavedAgendaDraft[]> {
    return this.serialize(async () => { await this.read(); return this.sorted() })
  }

  load(draftKey: string): Promise<SavedAgendaDraft | null> {
    return this.serialize(async () => { await this.read(); return this.view(draftKey) })
  }

  saveTopics(input: AgendaDraftSaveInput): Promise<AgendaDraftWriteResult> {
    return this.serialize(() => this.applyTopics(input))
  }

  saveGenerated(record: AgendaDraftRecord, expectedRevision: number): Promise<AgendaDraftWriteResult> {
    return this.serialize(() => this.applyGenerated(record, expectedRevision))
  }

  remove(draftKey: string): Promise<AgendaDraftRemoveResult> {
    return this.serialize(() => this.applyRemoval(draftKey))
  }

  private async applyTopics(input: AgendaDraftSaveInput): Promise<AgendaDraftWriteResult> {
    const topics = validatedAgendaTopics(input.topics)
    if (!topics || !Number.isInteger(input.expectedRevision)) return this.reject(input.draftKey, 'invalid', 'Agenda topics were not valid and were not saved.')
    const entry = (await this.read()).get(input.draftKey)
    if (!entry) return this.reject(input.draftKey, 'missing', 'No saved agenda draft exists for this event. Generate the agenda again.')
    if (!topicsApplyTo(entry.record, topics)) return this.reject(input.draftKey, 'invalid', 'Agenda topics did not match the saved draft and were not saved.')
    if (entry.record.revision !== input.expectedRevision) return this.conflict(entry)
    if (!entry.durable && agendaDraftTopics(entry.record).every((topic, index) => topic === topics[index])) return this.persist(entry)
    entry.record = { ...entry.record, items: applyAgendaTopics(entry.record, topics), revision: entry.record.revision + 1, updatedAt: this.timestamp() }
    return this.persist(entry)
  }

  private async applyGenerated(record: AgendaDraftRecord, expectedRevision: number): Promise<AgendaDraftWriteResult> {
    const entries = await this.read()
    const existing = entries.get(record.draftKey)
    if (existing && existing.record.revision !== expectedRevision) return this.conflict(existing)
    if (!existing && expectedRevision > 0) return this.reject(record.draftKey, 'conflict', 'The saved agenda changed. Reload the saved version before generating again.')
    if (!existing && entries.size >= MAX_SAVED_AGENDA_DRAFTS) {
      return this.reject(record.draftKey, 'limit', `Saved agendas reached the local limit of ${MAX_SAVED_AGENDA_DRAFTS} drafts. Delete a saved agenda, then generate again.`)
    }
    const entry: Entry = { record: { ...record, revision: (existing?.record.revision ?? 0) + 1, updatedAt: this.timestamp() }, durable: false }
    entries.set(record.draftKey, entry)
    return this.persist(entry)
  }

  private async applyRemoval(draftKey: string): Promise<AgendaDraftRemoveResult> {
    const entries = await this.read()
    const entry = entries.get(draftKey)
    if (!entry) return { removed: false }
    entries.delete(draftKey)
    try {
      await this.writeDocument()
      return { removed: true }
    } catch (error) {
      entries.set(draftKey, entry)
      return { removed: false, error: messageOf(error) }
    }
  }

  /** A failed disk write keeps the accepted change in memory and reports it as not durable. */
  private async persist(entry: Entry): Promise<AgendaDraftWriteResult> {
    try {
      await this.writeDocument()
      for (const stored of this.entries.values()) stored.durable = true
      return this.accepted(entry)
    } catch (error) {
      entry.durable = false
      return { ...this.accepted(entry), durable: false, error: messageOf(error) }
    }
  }

  private accepted(entry: Entry): AgendaDraftWriteResult {
    return { ok: true, draftKey: entry.record.draftKey, revision: entry.record.revision, durable: true, current: this.snapshot(entry) }
  }

  private conflict(entry: Entry): AgendaDraftWriteResult {
    const current = this.snapshot(entry)
    const conflict: AgendaDraftConflict = { revision: entry.record.revision, updatedAt: entry.record.updatedAt, topics: agendaDraftTopics(entry.record) }
    return {
      ok: false, reason: 'conflict', draftKey: entry.record.draftKey, revision: entry.record.revision, durable: entry.durable,
      current, conflict, error: 'This saved agenda changed since it was loaded. Reload the saved version before saving.',
    }
  }

  private async reject(draftKey: string, reason: AgendaDraftWriteResult['reason'], error: string): Promise<AgendaDraftWriteResult> {
    const entry = (await this.read()).get(draftKey)
    return { ok: false, reason, error, draftKey, revision: entry?.record.revision ?? 0, durable: entry?.durable ?? false, current: entry ? this.snapshot(entry) : null }
  }

  private view(draftKey: string): SavedAgendaDraft | null {
    const entry = this.entries.get(draftKey)
    return entry ? this.snapshot(entry) : null
  }

  private snapshot(entry: Entry): SavedAgendaDraft {
    return { ...entry.record, durable: entry.durable }
  }

  private sorted(): SavedAgendaDraft[] {
    return [...this.entries.values()].map((entry) => this.snapshot(entry)).sort(byEventStart)
  }

  private async read(): Promise<Map<string, Entry>> {
    if (this.document) return this.entries
    const stored = await this.store.read()
    this.document = stored === null ? { version: SAVED_AGENDA_VERSION, drafts: [] } : requireDocument(stored)
    this.entries = new Map(this.document.drafts.map((record) => [record.draftKey, { record, durable: true }]))
    return this.entries
  }

  private async writeDocument(): Promise<void> {
    if (!this.document) return
    this.document = { version: SAVED_AGENDA_VERSION, drafts: [...this.entries.values()].map((entry) => entry.record) }
    await this.store.write(this.document)
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

function requireDocument(stored: AgendaDraftDocument): AgendaDraftDocument {
  const document = validatedSavedAgendaDocument(stored)
  if (!document) throw new Error('Saved agendas could not be read because the local file has unsupported or damaged records. Nothing was changed.')
  return document
}

function byEventStart(left: SavedAgendaDraft, right: SavedAgendaDraft): number {
  return right.eventStart.localeCompare(left.eventStart) || left.title.localeCompare(right.title)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
