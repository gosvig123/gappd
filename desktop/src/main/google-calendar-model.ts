import type { CalendarAttendee, CalendarEventSummary, CalendarParticipant } from '../shared/calendar-contract'

const PRIMARY_CALENDAR_ID = 'primary'
const CANCELLED_STATUS = 'cancelled'
const CONFIRMED_STATUS = 'confirmed'
const UNTITLED_EVENT = 'Untitled event'

type GoogleParticipant = { email?: string; displayName?: string }
type GoogleAttendee = GoogleParticipant & { responseStatus?: string; self?: boolean; resource?: boolean }

export type GoogleEventItem = {
  id?: string
  status?: string
  summary?: string
  location?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  attendees?: GoogleAttendee[]
  organizer?: GoogleParticipant
}

export function mapGoogleEvent(item: GoogleEventItem, connectionId: string, accountEmail: string): CalendarEventSummary | null {
  if (!item.id || item.status === CANCELLED_STATUS) return null
  const start = item.start?.dateTime || item.start?.date
  const end = item.end?.dateTime || item.end?.date
  const allDay = Boolean(item.start?.date && !item.start?.dateTime)
  if (!start || !end || !validRange(start, end, allDay)) return null
  return {
    connectionId, accountEmail,
    calendarId: PRIMARY_CALENDAR_ID,
    eventId: item.id,
    sourceId: `${connectionId}:${PRIMARY_CALENDAR_ID}:${item.id}`,
    title: item.summary?.trim() || UNTITLED_EVENT,
    start, end, allDay,
    status: item.status || CONFIRMED_STATUS,
    location: item.location?.trim() || undefined,
    attendees: item.attendees?.flatMap(mapAttendee),
    organizer: mapParticipant(item.organizer),
  }
}

function mapParticipant(item?: GoogleParticipant): CalendarParticipant | undefined {
  const email = item?.email?.trim()
  return email ? { email, name: item?.displayName?.trim() || undefined } : undefined
}

function mapAttendee(item: GoogleAttendee): CalendarAttendee[] {
  const person = mapParticipant(item)
  if (!person || item.resource) return []
  return [{ ...person, responseStatus: item.responseStatus?.trim() || undefined, self: item.self }]
}

function validRange(start: string, end: string, allDay: boolean): boolean {
  if (allDay) return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end > start
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  return Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
}
