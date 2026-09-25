import type {
  AgendaDraftDocument, AgendaDraftRecord, AgendaDraftRemoveResult, AgendaDraftSaveInput, AgendaDraftWriteResult,
  GeneratedAgenda, SavedAgendaDraft,
} from '../shared/agenda-draft'
import { agendaDraftKey, agendaDraftKeyFromSourceId } from '../shared/agenda-draft'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { AgendaGeneration } from '../shared/generated/contracts'
import type { MeetingAgendaDraft } from '../shared/meeting-agenda'
import { AgendaDraftStore } from './agenda-draft-store'
import { createSecureStore } from './electron-secure-store'

const STORE_FILE = 'agenda-drafts.enc'
let instance: AgendaDraftStore | null = null

function drafts(): AgendaDraftStore {
  if (!instance) instance = new AgendaDraftStore(createSecureStore<AgendaDraftDocument>(STORE_FILE))
  return instance
}

export function loadSavedAgenda(draftKey: string): Promise<SavedAgendaDraft | null> {
  return drafts().load(draftKey)
}

export function listSavedAgendas(): Promise<SavedAgendaDraft[]> {
  return drafts().list()
}

export function saveAgendaTopics(input: AgendaDraftSaveInput): Promise<AgendaDraftWriteResult> {
  return drafts().saveTopics(input)
}

export function removeSavedAgenda(draftKey: string): Promise<AgendaDraftRemoveResult> {
  return drafts().remove(draftKey)
}

/** Key for one event, used by the renderer to address an existing saved draft. */
export function savedAgendaKey(event: Pick<CalendarEventSummary, 'accountEmail' | 'calendarId' | 'eventId'>): string {
  return agendaDraftKey(event)
}

export function savedAgendaKeyFromSourceId(accountEmail: string, sourceId: string): string | null {
  return agendaDraftKeyFromSourceId(accountEmail, sourceId)
}

/**
 * Saves a completed generation against the revision the renderer started from.
 * A newer saved revision is reported instead of being overwritten, and the event
 * plus generation metadata come from trusted main-process data.
 */
export async function persistGeneratedAgenda(input: { event: CalendarEventSummary; draft: MeetingAgendaDraft; generation?: AgendaGeneration; expectedRevision: number }): Promise<GeneratedAgenda> {
  const generatedAt = new Date().toISOString()
  const draftKey = agendaDraftKey(input.event)
  const result = await drafts().saveGenerated(recordFor(input, draftKey, generatedAt), input.expectedRevision)
  return {
    sourceId: input.event.sourceId, draftKey,
    draft: result.ok ? input.draft : null,
    saved: result.ok && result.durable, durable: result.durable, conflict: result.reason === 'conflict',
    revision: result.revision, generatedAt,
    model: result.current?.model ?? '', reasoningEffort: result.current?.reasoningEffort ?? '',
    ...(result.error ? { error: result.error } : {}),
  }
}

function recordFor(input: { event: CalendarEventSummary; draft: MeetingAgendaDraft; generation?: AgendaGeneration }, draftKey: string, generatedAt: string): AgendaDraftRecord {
  const { event, draft, generation } = input
  return {
    draftKey,
    sourceId: event.sourceId,
    title: event.title,
    accountEmail: event.accountEmail,
    eventStart: event.start,
    eventEnd: event.end,
    items: draft.items,
    sources: draft.sources,
    historyIncomplete: Boolean(draft.historyIncomplete),
    ...(draft.historyWarning ? { historyWarning: draft.historyWarning } : {}),
    ...(draft.communicationWarning ? { communicationWarning: draft.communicationWarning } : {}),
    ...(draft.ambiguousMeetings?.length ? { ambiguousMeetings: draft.ambiguousMeetings } : {}),
    generatedAt,
    updatedAt: generatedAt,
    model: generation?.model ?? '',
    reasoningEffort: generation?.reasoningEffort ?? '',
    revision: 0,
  }
}
