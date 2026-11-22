import type { CalendarAttendee, CalendarEventSummary, CalendarParticipant } from '../../shared/calendar-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { UNTITLED_EVENT_TITLE } from '../../shared/meeting-title.ts'

const PRIMARY_CALENDAR_ID = 'primary'
const CANCELLED_STATUS = 'cancelled'
const CONFIRMED_STATUS = 'confirmed'

type GoogleParticipant = { email?: string; displayName?: string }
type GoogleAttendee = GoogleParticipant & { responseStatus?: string; self?: boolean; resource?: boolean }

export type GoogleEventItem = {
  recurringEventId?: string
  id?: string
  status?: string
  summary?: string
  location?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
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
  const joinUrl = eventJoinUrl(item)
  return {
    connectionId, accountEmail,
    calendarId: PRIMARY_CALENDAR_ID,
    eventId: item.id,
    recurringEventId: item.recurringEventId,
    sourceId: `${connectionId}:${PRIMARY_CALENDAR_ID}:${item.id}`,
    title: item.summary?.trim() || UNTITLED_EVENT_TITLE,
    start, end, allDay,
    status: item.status || CONFIRMED_STATUS,
    location: item.location?.trim() || undefined,
    ...(joinUrl ? { joinUrl } : {}),
    attendees: item.attendees?.flatMap(mapAttendee),
    organizer: mapParticipant(item.organizer),
  }
}

/** Video call services whose links count as a call link when they appear in free-text location. */
const CALL_HOSTS = /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)$/

/** The video call link: Google's conference entry point, the Meet link, or a known call service's link in the location. */
function eventJoinUrl(item: GoogleEventItem): string | undefined {
  const video = item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri
  for (const candidate of [video, item.hangoutLink]) {
    const url = webUrl(candidate)
    if (url) return url.href
  }
  // Location is free text: take the first web address without surrounding punctuation, and only for a known call service.
  const fromLocation = webUrl(item.location?.match(/https?:\/\/[^\s<>"']+/i)?.[0].replace(/[.,;:!?)\]}]+$/, ''))
  return fromLocation && CALL_HOSTS.test(fromLocation.hostname) ? fromLocation.href : undefined
}

function webUrl(candidate?: string): URL | undefined {
  try {
    const url = candidate ? new URL(candidate.trim()) : undefined
    return url && /^https?:$/.test(url.protocol) ? url : undefined
  } catch {
    return undefined
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
