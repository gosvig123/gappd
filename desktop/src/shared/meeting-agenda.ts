import type { CalendarEventSummary } from './calendar-contract'
import type { AgendaItem } from './generated/contracts'

export type AgendaSource = { id: string; title: string; startedAt: string }
export type MeetingAgendaDraft = { items: AgendaItem[]; sources: AgendaSource[] }
export type AgendaHistory = AgendaSource & { emails: string[]; event?: CalendarEventSummary }
const MAX_SOURCES = 12
const RECENT_SOURCES = 6

export function normalizeInviteeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function inviteeEmails(event: CalendarEventSummary, selfEmails: string[]): string[] {
  const self = new Set([...selfEmails, event.accountEmail, ...(event.attendees ?? []).filter(person => person.self).map(person => person.email)].map(normalizeInviteeEmail))
  return [...new Set((event.attendees ?? []).filter(person => !person.self).map(person => normalizeInviteeEmail(person.email)).filter(email => email && !self.has(email)))]
}

export function matchAgendaHistory(event: CalendarEventSummary, history: AgendaHistory[], selfEmails: string[], now = Date.now()): AgendaSource[] {
  const invitees = new Set(inviteeEmails(event, [...selfEmails, ...history.flatMap(source => source.event ? [source.event.accountEmail] : [])]))
  const cutoff = Math.min(Date.parse(event.start), now)
  const matches = history.map(source => rankSource(event, source, invitees, cutoff)).filter(source => source.overlap > 0)
  const recent = [...matches].sort((a, b) => b.time - a.time).slice(0, RECENT_SOURCES)
  const ranked = matches.sort((a, b) => Number(b.series) - Number(a.series) || b.overlap - a.overlap || b.time - a.time)
  const selected = new Map(recent.map(match => [match.source.id, match.source]))
  for (const match of ranked) { if (selected.size >= MAX_SOURCES) break; selected.set(match.source.id, match.source) }
  return [...selected.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map(({ id, title, startedAt }) => ({ id, title, startedAt }))
}

function rankSource(event: CalendarEventSummary, source: AgendaHistory, invitees: Set<string>, cutoff: number) {
  const time = Date.parse(source.startedAt)
  const overlap = time < cutoff ? new Set(source.emails.map(normalizeInviteeEmail).filter(email => invitees.has(email))).size : 0
  const series = Boolean(event.recurringEventId && source.event?.recurringEventId === event.recurringEventId && normalizeInviteeEmail(source.event.accountEmail) === normalizeInviteeEmail(event.accountEmail) && source.event.calendarId === event.calendarId)
  return { source, overlap, time, series }
}

export function calendarEventIsUpcoming(event: CalendarEventSummary, now = new Date()): boolean {
  if (!event.allDay) return Date.parse(event.end) > now.getTime()
  const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return event.end > localDay
}
