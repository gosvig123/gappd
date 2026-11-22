// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { calendarEventKey, type CalendarEventSummary } from './calendar-contract.ts'

/** The reminder appears this long before a Calendar event starts. */
export const REMINDER_LEAD_MS = 60_000
/** After this long past the start, a missed reminder is no longer shown (for example after sleep or a late launch). */
export const REMINDER_LATE_MS = 5 * 60_000

/** Identity of one reminder: a moved event gets a new reminder. */
export function reminderKey(event: CalendarEventSummary): string {
  return `${calendarEventKey(event)}@${event.start}`
}

/** A reminder may stay on screen for this event: timed, not over, not cancelled or declined, with someone else invited. */
export function reminderEligible(event: CalendarEventSummary, now = new Date()): boolean {
  if (event.allDay || event.status === 'cancelled' || Date.parse(event.end) <= now.getTime()) return false
  const attendees = event.attendees ?? []
  if (attendees.some((person) => person.self && person.responseStatus === 'declined')) return false
  const self = event.accountEmail.trim().toLowerCase()
  return attendees.some((person) => !person.self && person.email.trim().toLowerCase() !== self)
}

/** Eligible events that start about now, earliest first. */
export function reminderDueEvents(events: CalendarEventSummary[], now = new Date()): CalendarEventSummary[] {
  return events.filter((event) => {
    const untilStart = Date.parse(event.start) - now.getTime()
    return untilStart <= REMINDER_LEAD_MS && untilStart >= -REMINDER_LATE_MS && reminderEligible(event, now)
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
