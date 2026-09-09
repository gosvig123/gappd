import type { AgendaHistory, CalendarProvenance, MeetingAgendaDraft } from './meeting-agenda'
import type { CalendarSnapshot, CalendarEventSummary } from './calendar-contract'
import type { ParticipantContext } from './participant-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { inviteeEmails, normalizeInviteeEmail, INFERRED_CALENDAR_PROVENANCE, CONFIRMED_CALENDAR_PROVENANCE } from './meeting-agenda.ts'

const CANCELLED_STATUS = 'cancelled'
const DECLINED_STATUS = 'declined'
const MINIMUM_OVERLAP_FRACTION = 0.5
export type MeetingInterval = { startedAt: string; endedAt?: string }
export type CalendarEvidence = { calendarAmbiguous?: boolean; event?: CalendarEventSummary; calendarProvenance?: CalendarProvenance }

export function reconcileMeetingCalendar(meeting: MeetingInterval, saved: ParticipantContext | undefined, events: CalendarEventSummary[], selfEmails: string[]): CalendarEvidence {
  if (saved?.event) return { event: saved.event, calendarProvenance: CONFIRMED_CALENDAR_PROVENANCE }
  if (saved?.inferenceDisabled) return {}
  const start = Date.parse(meeting.startedAt), end = Date.parse(meeting.endedAt ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {}
  const overlaps = events.filter(event => eligibleEvent(event, selfEmails)).map(event => ({
    event, duration: Math.min(end, Date.parse(event.end)) - Math.max(start, Date.parse(event.start)),
  })).filter(match => match.duration > 0)
  if (overlaps.length > 1) return { calendarAmbiguous: true }
  if (overlaps.length !== 1 || overlaps[0].duration < (end - start) * MINIMUM_OVERLAP_FRACTION) return {}
  return { event: overlaps[0].event, calendarProvenance: INFERRED_CALENDAR_PROVENANCE }
}

function eligibleEvent(event: CalendarEventSummary, selfEmails: string[]): boolean {
  if (event.allDay || event.status === CANCELLED_STATUS || !inviteeEmails(event, selfEmails).length) return false
  const account = normalizeInviteeEmail(event.accountEmail)
  return !(event.attendees ?? []).some(person => (person.self || normalizeInviteeEmail(person.email) === account) && person.responseStatus === DECLINED_STATUS)
}

export function reconcileAgendaHistory(meetings: AgendaHistory[], contexts: Record<string, ParticipantContext>, snapshot: CalendarSnapshot): AgendaHistory[] {
  const selfEmails = snapshot.connections.map(connection => connection.email)
  const available = new Set(snapshot.connections.filter(connection => !connection.error).map(connection => connection.id))
  const events = snapshot.events.filter(event => available.has(event.connectionId))
  return meetings.map(meeting => {
    const saved = contexts[meeting.id]
    const unavailable = !saved?.event && !saved?.inferenceDisabled && !meetingHasCalendarCoverage(meeting, snapshot)
    const evidence = reconcileMeetingCalendar(meeting, saved, unavailable ? [] : events, selfEmails)
    const { event } = evidence
    return { ...meeting, ...evidence, calendarReconciliationUnavailable: unavailable, calendarTitle: event?.title, emails: [...meeting.emails, ...(event ? inviteeEmails(event, selfEmails) : [])] }
  })
}

export function meetingHasCalendarCoverage(meeting: MeetingInterval, snapshot: CalendarSnapshot): boolean {
  const start = Date.parse(meeting.startedAt), end = Date.parse(meeting.endedAt ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !snapshot.connections.length) return false
  return snapshot.connections.every(connection => {
    if (connection.error || !connection.historyRanges) return false
    let coveredUntil = start
    for (const range of [...connection.historyRanges].sort((left, right) => left.start - right.start)) {
      if (range.start > coveredUntil) break
      coveredUntil = Math.max(coveredUntil, range.end)
      if (coveredUntil >= end) return true
    }
    return false
  })
}

export function agendaReconciliationStatus(history: AgendaHistory[]): Pick<MeetingAgendaDraft, 'historyIncomplete' | 'ambiguousMeetings'> {
  return {
    historyIncomplete: history.some(meeting => meeting.calendarReconciliationUnavailable),
    ambiguousMeetings: history.filter(meeting => meeting.calendarAmbiguous).map(({ id, title, startedAt }) => ({ id, title, startedAt })),
  }
}
