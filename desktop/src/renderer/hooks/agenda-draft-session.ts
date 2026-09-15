import type {
  AgendaDraftSaveInput, AgendaDraftWriteResult, GeneratedAgenda, SavedAgendaDraft,
} from '../../shared/agenda-draft'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { agendaDraftTopics, agendaDraftViewOf } from '../../shared/agenda-draft.ts'
import type { AgendaDraftView } from '../../shared/agenda-draft'
import type { MeetingAgendaDraft } from '../../shared/meeting-agenda'

export const AUTOSAVE_DELAY_MS = 700

export type AgendaSaveState = 'clean' | 'saving' | 'pending' | 'failed' | 'conflict'

export type AgendaSessionState = {
  draftKey: string
  sourceId: string
  draft: AgendaDraftView | null
  loading: boolean
  generating: boolean
  saveState: AgendaSaveState
  error: string
  canGenerate: boolean
  topics: string[]
}

/** Boundary the session talks to; the hook supplies window.gappd operations. */
export type AgendaPort = {
  load(draftKey: string): Promise<SavedAgendaDraft | null>
  save(input: AgendaDraftSaveInput): Promise<AgendaDraftWriteResult>
  remove(draftKey: string): Promise<{ removed: boolean; error?: string }>
  generate(input: { sourceId: string; expectedRevision: number }): Promise<GeneratedAgenda>
  now(): string
}

export type AgendaScheduler = { schedule(work: () => void, delayMs: number): unknown; cancel(handle: unknown): void }

type SessionHooks = { onState(state: AgendaSessionState): void; scheduler: AgendaScheduler }

const INITIAL = { draft: null, loading: true, generating: false, saveState: 'clean' as AgendaSaveState, error: '', canGenerate: false, topics: [] }

/**
 * One saved Agenda draft, isolated by draft key. Loads, edits, generations and
 * save responses only apply to the revision they started from, so a delayed
 * response can never replace newer edits or another event's draft.
 */
export class AgendaDraftSession {
  private readonly port: AgendaPort
  private readonly hooks: SessionHooks
  private state: AgendaSessionState
  private revision = 0
  private loaded = false
  private sessionVersion = 0
  private generationVersion = 0
  private editVersion = 0
  private generating = false
  private saving = false
  private timer: unknown = null
  private stopped = false
  private removed = false

  constructor(port: AgendaPort, hooks: SessionHooks, input: { draftKey: string; sourceId: string }) {
    this.port = port
    this.hooks = hooks
    this.state = { ...INITIAL, draftKey: input.draftKey, sourceId: input.sourceId }
  }

  snapshot(): AgendaSessionState {
    return this.state
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.load()
  }

  stop(): void {
    const queued = this.timer !== null
    this.stopped = true
    this.generationVersion += 1
    this.clearTimer()
    if (queued || this.saving) void this.save()
  }

  /** Topic edits are local first; autosave is scheduled only after a successful load. */
  setTopics(topics: string[]): void {
    if (!this.state.draft || this.state.saveState === 'conflict') return
    this.editVersion += 1
    this.update({ draft: viewWithTopics(this.state.draft, topics), topics, saveState: this.saving ? 'saving' : 'pending', error: '' })
    this.scheduleSave()
  }

  async retrySave(): Promise<void> {
    if (this.state.saveState !== 'conflict') await this.save()
  }

  async reload(): Promise<void> {
    await this.load()
  }

  async remove(): Promise<void> {
    const sessionVersion = ++this.sessionVersion
    this.generationVersion += 1
    const result = await this.port.remove(this.state.draftKey)
    if (this.stopped || sessionVersion !== this.sessionVersion) return
    if (result.error) {
      this.update({ error: result.error })
      return
    }
    this.clearTimer()
    this.revision = 0
    this.editVersion += 1
    this.loaded = false
    this.removed = true
    this.update({ draft: null, topics: [], saveState: 'clean', error: '', loading: false, canGenerate: false })
  }

  async generate(): Promise<void> {
    if (!this.loaded || this.generating || this.state.generating || this.state.saveState === 'conflict') return
    const sessionVersion = this.sessionVersion
    const generationVersion = ++this.generationVersion
    const editVersion = this.editVersion
    this.generating = true
    this.update({ generating: true, error: '' })
    try {
      const result = await this.port.generate({ sourceId: this.state.sourceId, expectedRevision: this.revision })
      if (this.stopped || sessionVersion !== this.sessionVersion || editVersion !== this.editVersion) return
      this.applyGeneration(result)
    } catch (cause) {
      if (!this.stopped && sessionVersion === this.sessionVersion) this.update({ error: messageOf(cause) })
    } finally {
      if (generationVersion !== this.generationVersion) return
      this.generating = false
      if (!this.stopped && sessionVersion === this.sessionVersion) this.update({ generating: false })
    }
  }

  private async load(): Promise<void> {
    const sessionVersion = ++this.sessionVersion
    this.generationVersion += 1
    this.generating = false
    this.editVersion += 1
    this.clearTimer()
    this.loaded = false
    this.update({ loading: true, generating: false, error: '', canGenerate: false, saveState: 'clean' })
    try {
      const record = await this.port.load(this.state.draftKey)
      if (this.stopped || sessionVersion !== this.sessionVersion) return
      this.revision = record?.revision ?? 0
      this.loaded = true
      this.removed = false
      this.update({
        draft: record ? agendaDraftViewOf(record) : null, topics: record ? agendaDraftTopics(record) : [], loading: false, canGenerate: true,
        saveState: record && !record.durable ? 'failed' : 'clean',
        error: record && !record.durable ? 'This saved agenda is not on disk yet. Retry save before closing Gappd.' : '',
      })
    } catch (cause) {
      if (this.stopped || sessionVersion !== this.sessionVersion) return
      this.update({ loading: false, error: messageOf(cause), canGenerate: false })
    }
  }

  private applyGeneration(result: GeneratedAgenda): void {
    const draft = result.draft
    if (result.conflict || !draft) {
      this.clearTimer()
      this.update({ saveState: 'conflict', error: result.error ?? 'A newer saved agenda exists. Reload the saved version before generating again.' })
      return
    }
    this.revision = result.revision
    const view = viewFromGeneration(result, draft)
    this.update({
      draft: view, topics: view.items.map((item) => item.topic), error: result.error ?? '',
      saveState: result.durable ? 'clean' : 'failed',
    })
  }

  private scheduleSave(): void {
    this.clearTimer()
    this.timer = this.hooks.scheduler.schedule(() => { this.timer = null; void this.save() }, AUTOSAVE_DELAY_MS)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    this.hooks.scheduler.cancel(this.timer)
    this.timer = null
  }

  /** Saves are serialized per session; edits made during a save trigger one more save. */
  private async save(): Promise<void> {
    const draft = this.state.draft
    if (!draft || this.saving || !this.loaded || this.removed || this.state.saveState === 'conflict') return
    const sessionVersion = this.sessionVersion
    const editVersion = this.editVersion
    const topics = this.state.topics
    const expectedRevision = this.revision
    this.saving = true
    this.update({ saveState: 'saving' })
    try {
      const result = await this.port.save({ draftKey: this.state.draftKey, expectedRevision, topics })
      if (sessionVersion !== this.sessionVersion) return
      this.applySaveResult(result, editVersion)
    } catch (cause) {
      if (sessionVersion === this.sessionVersion) this.update({ saveState: this.editVersion === editVersion ? 'failed' : 'pending', error: messageOf(cause) })
    } finally {
      this.saving = false
      if (sessionVersion === this.sessionVersion && this.editVersion !== editVersion) {
        if (this.stopped) void this.save()
        else this.scheduleSave()
      }
    }
  }

  private applySaveResult(result: AgendaDraftWriteResult, editVersion: number): void {
    if (!result.ok) {
      if (result.reason === 'conflict') {
        this.revision = result.revision
        this.clearTimer()
      }
      this.update({
        draft: result.reason === 'conflict' ? draftAtRevision(this.state.draft, result) : this.state.draft,
        saveState: result.reason === 'conflict' ? 'conflict' : 'failed',
        error: result.error ?? 'The saved agenda could not be updated.',
      })
      return
    }
    this.revision = result.revision
    const pending = editVersion !== this.editVersion
    this.update({
      draft: pending ? draftAtRevision(this.state.draft, result) : result.current ? agendaDraftViewOf(result.current) : this.state.draft,
      saveState: pending ? 'pending' : result.durable ? 'clean' : 'failed',
      error: result.error ?? '',
    })
  }

  private update(patch: Partial<AgendaSessionState>): void {
    this.state = { ...this.state, ...patch }
    if (!this.stopped) this.hooks.onState(this.state)
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function draftAtRevision(draft: AgendaDraftView | null, result: AgendaDraftWriteResult): AgendaDraftView | null {
  return draft ? { ...draft, revision: result.revision, durable: result.durable, updatedAt: result.current?.updatedAt ?? draft.updatedAt } : null
}

function viewWithTopics(draft: AgendaDraftView, topics: string[]): AgendaDraftView {
  return { ...draft, items: draft.items.map((item, index) => ({ ...item, topic: topics[index] ?? item.topic })) }
}

function viewFromGeneration(result: GeneratedAgenda, draft: MeetingAgendaDraft): AgendaDraftView {
  return {
    ...draft,
    draftKey: result.draftKey, sourceId: result.sourceId, revision: result.revision, durable: result.durable,
    generatedAt: result.generatedAt, updatedAt: result.generatedAt, model: result.model, reasoningEffort: result.reasoningEffort,
  }
}
