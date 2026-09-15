import type { CalendarAttendee, CalendarEventSummary, CalendarParticipant } from './calendar-contract'

// Bounds the speaker picker: a large Calendar can hold thousands of attendees.
const MAX_CONTACTS = 300
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WHITESPACE = /\s+/g

// Contacts come from every cached event, so a label can reuse an invitee seen in another Meeting.
export function collectCalendarContacts(events: CalendarEventSummary[]): CalendarParticipant[] {
  const index = new Map<string, string>()
  for (const event of events) for (const attendee of event.attendees ?? []) remember(index, attendee, event.accountEmail)
  return [...index].map(toContact).sort(compareContacts).slice(0, MAX_CONTACTS)
}

function remember(index: Map<string, string>, attendee: CalendarAttendee, accountEmail: string): void {
  const email = attendee.email.trim().toLowerCase()
  if (attendee.self || !EMAIL_PATTERN.test(email) || email === accountEmail.trim().toLowerCase()) return
  const name = attendee.name?.trim().replace(WHITESPACE, ' ') ?? ''
  if (name) index.set(email, name)
  else if (!index.has(email)) index.set(email, '')
}

function toContact([email, name]: [string, string]): CalendarParticipant {
  return name ? { email, name } : { email }
}

function compareContacts(left: CalendarParticipant, right: CalendarParticipant): number {
  return (left.name ?? left.email).localeCompare(right.name ?? right.email) || left.email.localeCompare(right.email)
}
