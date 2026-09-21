import type { AgendaItem } from './generated/contracts'
import type { CalendarEventSummary } from './calendar-contract'
import type { AgendaSource, MeetingAgendaDraft } from './meeting-agenda'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { calendarEventIsUpcoming } from './meeting-agenda.ts'

export const SAVED_AGENDA_VERSION = 2
export const SAVED_AGENDA_LEGACY_VERSION = 1
export const MAX_SAVED_AGENDA_DRAFTS = 100
export const MAX_AGENDA_ITEMS = 200
export const MAX_AGENDA_TEXT_LENGTH = 2000

export type AgendaSourceRecord = Pick<AgendaSource, 'id' | 'title' | 'startedAt'> & Pick<Partial<AgendaSource>, 'calendarProvenance' | 'calendarTitle' | 'kind'>

/** Source evidence is owned by main and never accepted from the renderer. */
export type AgendaItemRecord = { topic: string; sourceId: string; quote: string }

/**
 * One locally saved Agenda draft. The key is the stable account plus Calendar
 * event identity, so a reconnect keeps its saved draft.
 */
export type AgendaDraftRecord = {
  draftKey: string
  sourceId: string
  title: string
  accountEmail: string
  eventStart: string
  eventEnd: string
  items: AgendaItemRecord[]
  sources: AgendaSourceRecord[]
  historyIncomplete: boolean
  historyWarning?: string
  communicationWarning?: string
  ambiguousMeetings?: AgendaSourceRecord[]
  generatedAt: string
  updatedAt: string
  model: string
  reasoningEffort: string
  revision: number
}

/** `durable` is false while an accepted change is not yet on disk. */
export type SavedAgendaDraft = AgendaDraftRecord & { durable: boolean }

export type AgendaDraftDocument = { version: number; drafts: AgendaDraftRecord[] }

/** Renderer saves topic text only; item identity, source and quote stay in main. */
export type AgendaDraftSaveInput = { draftKey: string; expectedRevision: number; topics: string[] }

export type AgendaDraftConflict = { revision: number; updatedAt: string; topics: string[] }

export type AgendaDraftWriteReason = 'missing' | 'conflict' | 'invalid' | 'limit' | 'damaged'

export type AgendaDraftWriteResult = {
  ok: boolean
  reason?: AgendaDraftWriteReason
  error?: string
  draftKey: string
  revision: number
  durable: boolean
  current?: SavedAgendaDraft | null
  conflict?: AgendaDraftConflict
}

export type AgendaDraftRemoveResult = { removed: boolean; error?: string }

export type GeneratedAgenda = {
  sourceId: string
  draftKey: string
  draft: MeetingAgendaDraft | null
  saved: boolean
  durable: boolean
  conflict: boolean
  revision: number
  generatedAt: string
  model: string
  reasoningEffort: string
  error?: string
}

export type AgendaDraftView = MeetingAgendaDraft & {
  draftKey: string
  sourceId: string
  revision: number
  durable: boolean
  generatedAt: string
  updatedAt: string
  model: string
  reasoningEffort: string
}

export function normalizeAccountKey(email: string): string {
  return email.trim().toLowerCase()
}

/** Stable draft identity: account plus Calendar event, independent of connection id. */
export function agendaDraftKey(event: Pick<CalendarEventSummary, 'accountEmail' | 'calendarId' | 'eventId'>): string {
  return `${normalizeAccountKey(event.accountEmail)}:${event.calendarId}:${event.eventId}`
}

/** Legacy records stored only `connectionId:calendarId:eventId`; migrate them once. */
export function agendaDraftKeyFromSourceId(accountEmail: string, sourceId: string): string | null {
  const parts = sourceId.split(':')
  if (parts.length !== 3 || !parts[1] || !parts[2] || !normalizeAccountKey(accountEmail)) return null
  return `${normalizeAccountKey(accountEmail)}:${parts[1]}:${parts[2]}`
}

export function agendaDraftViewOf(record: SavedAgendaDraft): AgendaDraftView {
  return {
    items: record.items,
    sources: record.sources,
    historyIncomplete: record.historyIncomplete,
    ...(record.historyWarning ? { historyWarning: record.historyWarning } : {}),
    ...(record.communicationWarning ? { communicationWarning: record.communicationWarning } : {}),
    ...(record.ambiguousMeetings?.length ? { ambiguousMeetings: record.ambiguousMeetings } : {}),
    draftKey: record.draftKey,
    sourceId: record.sourceId,
    revision: record.revision,
    durable: record.durable,
    generatedAt: record.generatedAt,
    updatedAt: record.updatedAt,
    model: record.model,
    reasoningEffort: record.reasoningEffort,
  }
}

export function agendaDraftTopics(record: Pick<AgendaDraftRecord, 'items'>): string[] {
  return record.items.map((item) => item.topic)
}

/** Topic text is the only renderer-owned content, so it is validated on its own. */
export function validatedAgendaTopics(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_AGENDA_ITEMS) return null
  if (!value.every((topic) => typeof topic === 'string' && topic.length <= MAX_AGENDA_TEXT_LENGTH)) return null
  return value.map((topic) => topic as string)
}

export function topicsApplyTo(record: Pick<AgendaDraftRecord, 'items'>, topics: string[]): boolean {
  return topics.length === record.items.length
}

export function applyAgendaTopics(record: AgendaDraftRecord, topics: string[]): AgendaItemRecord[] {
  return record.items.map((item, index) => ({ topic: topics[index] as string, sourceId: item.sourceId, quote: item.quote }))
}

export function agendaDraftEvent(record: AgendaDraftRecord, events: CalendarEventSummary[]): CalendarEventSummary | null {
  return events.find((event) => event.sourceId === record.sourceId || agendaDraftKey(event) === record.draftKey) ?? null
}

export function agendaDraftCanGenerate(record: AgendaDraftRecord, events: CalendarEventSummary[], now = new Date()): boolean {
  const event = agendaDraftEvent(record, events)
  return Boolean(event && calendarEventIsUpcoming(event, now))
}

/** Upcoming events already show one editor, so the Saved list only keeps the rest. */
export function savedAgendaDraftsOutsideUpcoming<T extends AgendaDraftRecord>(records: T[], events: CalendarEventSummary[], now = new Date()): T[] {
  const upcoming = new Set(events.filter((event) => calendarEventIsUpcoming(event, now)).map((event) => agendaDraftKey(event)))
  return records.filter((record) => !upcoming.has(record.draftKey))
}

/** Source Meeting ids that are no longer in local meeting history. */
export function missingAgendaSourceIds(record: AgendaDraftRecord, knownMeetingIds: ReadonlySet<string>): string[] {
  return record.sources.filter((source) => !source.kind && !knownMeetingIds.has(source.id)).map((source) => source.id)
}

export function agendaItemIsValid(value: unknown): value is AgendaItem {
  return validatedAgendaItem(value) !== null
}

function validatedAgendaItem(value: unknown): AgendaItemRecord | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const topic = textValue(candidate.topic)
  const sourceId = textValue(candidate.sourceId)
  const quote = textValue(candidate.quote)
  if (topic === null || sourceId === null || quote === null) return null
  return { topic, sourceId, quote }
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_AGENDA_TEXT_LENGTH ? value : null
}

export function isAgendaSourceRecord(value: unknown): value is AgendaSourceRecord {
  if (!value || typeof value !== 'object') return false
  const source = value as Record<string, unknown>
  return nonEmptyId(source.id) && typeof source.title === 'string' && typeof source.startedAt === 'string' && (source.kind === undefined || source.kind === 'gmail' || source.kind === 'slack')
}

function nonEmptyId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_AGENDA_TEXT_LENGTH
}

/**
 * Fail closed: one damaged record makes the whole document unreadable until the
 * user recovers it, so Gappd never filters or deletes stored drafts on write.
 */
export function validatedSavedAgendaDocument(value: unknown): AgendaDraftDocument | null {
  if (!value || typeof value !== 'object') return null
  const document = value as { version?: unknown; drafts?: unknown }
  if ((document.version !== SAVED_AGENDA_VERSION && document.version !== SAVED_AGENDA_LEGACY_VERSION) || !Array.isArray(document.drafts)) return null
  const drafts: AgendaDraftRecord[] = []
  const keys = new Set<string>()
  for (const entry of document.drafts) {
    const record = migratedAgendaDraftRecord(entry)
    if (!record || keys.has(record.draftKey)) return null
    keys.add(record.draftKey)
    drafts.push(record)
  }
  return { version: SAVED_AGENDA_VERSION, drafts }
}

function migratedAgendaDraftRecord(value: unknown): AgendaDraftRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const draftKey = typeof record.draftKey === 'string'
    ? normalizedAgendaDraftKey(record.draftKey)
    : typeof record.accountEmail === 'string' && typeof record.sourceId === 'string' ? agendaDraftKeyFromSourceId(record.accountEmail, record.sourceId) : null
  if (!draftKey || !nonEmptyId(record.sourceId) || !nonEmptyId(record.title) || !positiveRevision(record.revision)) return null
  if (!textFields(record) || !Array.isArray(record.sources) || !record.sources.every(isAgendaSourceRecord)) return null
  if (!Array.isArray(record.items) || record.items.length > MAX_AGENDA_ITEMS) return null
  const items: AgendaItemRecord[] = []
  for (const item of record.items) {
    const valid = validatedAgendaItem(item)
    if (!valid) return null
    items.push(valid)
  }
  const sources = record.sources as AgendaSourceRecord[]
  const ambiguousMeetings = Array.isArray(record.ambiguousMeetings) && record.ambiguousMeetings.every(isAgendaSourceRecord)
    ? record.ambiguousMeetings as AgendaSourceRecord[] : undefined
  return {
    draftKey, sourceId: record.sourceId as string, title: record.title as string,
    accountEmail: String(record.accountEmail), eventStart: String(record.eventStart), eventEnd: String(record.eventEnd),
    items, sources,
    historyIncomplete: Boolean(record.historyIncomplete),
    ...(typeof record.historyWarning === 'string' ? { historyWarning: record.historyWarning } : {}),
    ...(typeof record.communicationWarning === 'string' ? { communicationWarning: record.communicationWarning } : {}),
    ...(ambiguousMeetings ? { ambiguousMeetings } : {}),
    generatedAt: String(record.generatedAt), updatedAt: String(record.updatedAt),
    model: String(record.model), reasoningEffort: String(record.reasoningEffort), revision: record.revision as number,
  }
}

function normalizedAgendaDraftKey(value: string): string | null {
  const trimmed = value.trim()
  const parts = trimmed.split(':')
  if (!trimmed || (parts.length === 3 && !parts.every((part) => part.trim()))) return null
  return parts.length === 3 ? `${normalizeAccountKey(parts[0] as string)}:${parts[1]}:${parts[2]}` : trimmed
}

function textFields(record: Record<string, unknown>): boolean {
  const fields = ['accountEmail', 'eventStart', 'eventEnd', 'generatedAt', 'updatedAt', 'model', 'reasoningEffort']
  return fields.every((field) => typeof record[field] === 'string') && typeof record.historyIncomplete === 'boolean'
}

function positiveRevision(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
