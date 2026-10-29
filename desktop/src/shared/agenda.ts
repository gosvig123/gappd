import type { AgendaResponse, AgendaSource } from './generated/contracts'
import type { CalendarEventSummary } from './calendar-contract'
import type { ParticipantContext } from './participant-contract'
export type { AgendaSource } from './generated/contracts'

/** One Agenda point. Sources holds the refs of the Agenda sources it comes from; a point the user added has none. */
export type AgendaItem = { id: string; text: string; sources: string[] }

/** The editable Agenda of one upcoming Calendar event, saved on this Mac by event key. */
export type Agenda = {
  eventKey: string
  title: string
  start: string
  items: AgendaItem[]
  sources: AgendaSource[]
  /** When AI last drafted the items; empty when the user wrote every item. */
  draftedAt: string
  updatedAt: string
  /** True after the user changes a drafted item. */
  edited: boolean
}

export type AgendaRequest = { event: string; linked: string }

/** Agendas are drafted this long before an event starts when automatic drafting is on. */
export const AGENDA_LEAD_MS = 15 * 60_000
/** Must match agendaLookback in cmd/gappd/app_agenda.go. */
export const AGENDA_LOOKBACK_DAYS = 180
export const MAX_AGENDA_ITEMS = 30
export const MAX_AGENDA_ITEM_LENGTH = 500

/** The event and recent saved Meeting links, without your own emails, for backend relatedness matching. */
export function agendaRequest(event: CalendarEventSummary, contexts: Record<string, ParticipantContext>, selfEmails: string[]): AgendaRequest {
  const self = new Set([...selfEmails, event.accountEmail].map(normalEmail))
  const emails = inviteeEmails(event, self)
  const series = event.recurringEventId ?? ''
  const start = Date.parse(event.start)
  // One extra day keeps links whose recording started after its Calendar event; the backend applies the exact window.
  const since = start - (AGENDA_LOOKBACK_DAYS + 1) * 24 * 60 * 60_000
  const linked = Object.entries(contexts).flatMap(([id, context]) => {
    const past = context.event
    if (!past) return []
    const pastStart = Date.parse(past.start)
    if (!(pastStart >= since && pastStart < start)) return []
    const pastEmails = inviteeEmails(past, new Set([...self, normalEmail(past.accountEmail)]))
    if (!pastEmails.length && !past.recurringEventId) return []
    return [{ id, series: past.recurringEventId ?? '', emails: pastEmails }]
  })
  return {
    event: JSON.stringify({ start: new Date(event.start).toISOString(), series, emails, self: [...self] }),
    linked: JSON.stringify(linked),
  }
}

/** A saved Agenda from a backend draft. Item ids only need to be unique within the Agenda. */
export function draftedAgenda(eventKey: string, event: CalendarEventSummary, draft: AgendaResponse, now = new Date()): Agenda {
  const at = now.toISOString()
  const items = draft.items.map((item, index) => ({ id: `d${now.getTime()}-${index}`, text: item.text, sources: item.sources }))
  return { eventKey, title: event.title, start: event.start, items, sources: draft.sources, draftedAt: at, updatedAt: at, edited: false }
}

/** Events that need an automatic draft now: timed, starting within the lead time, with someone else invited, and without an Agenda. */
export function agendaDueEvents(events: CalendarEventSummary[], hasAgenda: (event: CalendarEventSummary) => boolean, now = new Date()): CalendarEventSummary[] {
  return events.filter((event) => {
    const start = Date.parse(event.start)
    return !event.allDay && event.status !== 'cancelled' && start > now.getTime() && start - now.getTime() <= AGENDA_LEAD_MS
      && (event.attendees ?? []).some((person) => !person.self && normalEmail(person.email) !== normalEmail(event.accountEmail))
      && !hasAgenda(event)
  })
}

/** Items as the user saved them: trimmed, non-empty, bounded, with sources that exist in the Agenda. */
export function cleanAgendaItems(items: unknown, sources: AgendaSource[]): AgendaItem[] {
  if (!Array.isArray(items)) throw new Error('Save agenda: items must be a list. Reload the agenda and try again.')
  if (items.length > MAX_AGENDA_ITEMS) throw new Error(`Save agenda: an agenda holds at most ${MAX_AGENDA_ITEMS} items. Remove some items and save again.`)
  const refs = new Set(sources.map((source) => source.ref))
  return items.flatMap((item, index) => {
    const value = item as Partial<AgendaItem>
    const text = typeof value.text === 'string' ? value.text.trim() : ''
    if (!text) return []
    if (text.length > MAX_AGENDA_ITEM_LENGTH) throw new Error(`Save agenda: item ${index + 1} is longer than ${MAX_AGENDA_ITEM_LENGTH} characters. Shorten it and save again.`)
    const id = typeof value.id === 'string' && value.id && value.id.length <= 64 ? value.id : `u${Date.now()}-${index}`
    const itemSources = Array.isArray(value.sources) ? [...new Set(value.sources.filter((ref): ref is string => typeof ref === 'string' && refs.has(ref)))].slice(0, 3) : []
    return [{ id, text, sources: itemSources }]
  })
}

function inviteeEmails(event: CalendarEventSummary, self: Set<string>): string[] {
  return [...new Set((event.attendees ?? []).filter((person) => !person.self).map((person) => normalEmail(person.email)).filter((email) => email && !self.has(email)))]
}

function normalEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase()
}
