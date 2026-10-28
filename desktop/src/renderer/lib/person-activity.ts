import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
import type { SavedPerson } from '../../shared/participant-contract'
import type { AppView } from './app-view'

/** The Meetings where a speaker is labeled as this Person, newest first. */
export function personMeetings(person: SavedPerson, view: Pick<AppView, 'meetings' | 'meetingDetails'>): MeetingListItem[] {
  return view.meetings.filter((meeting) => view.meetingDetails.get(meeting.id)?.speakers.some((speaker) => speaker.personId === person.id || speaker.name === person.name))
}

/** Calendar events that have not ended and list this Person's email, soonest first. */
export function personEvents(person: SavedPerson, calendar: CalendarSnapshot | null, limit = 3, now = new Date()): CalendarEventSummary[] {
  const email = person.email?.toLowerCase()
  if (!email || !calendar) return []
  return calendar.events
    .filter((event) => new Date(event.end).getTime() >= now.getTime() && event.attendees?.some((attendee) => attendee.email.toLowerCase() === email))
    .sort((left, right) => left.start.localeCompare(right.start))
    .slice(0, limit)
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?'
}

export function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
