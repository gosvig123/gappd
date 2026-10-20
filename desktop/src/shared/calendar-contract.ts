export type CalendarHistoryRange = { start: number; end: number }
/** Optional Google access beyond Calendar, granted per account. */
export type GoogleAccess = 'gmail' | 'contacts'

export type CalendarConnection = {
  id: string
  email: string
  status: 'ready' | 'syncing' | 'error'
  historyRanges?: CalendarHistoryRange[]
  lastSyncedAt?: string
  error?: string
  access?: GoogleAccess[]
}

export type CalendarParticipant = { email: string; name?: string }
/** One Gmail thread with a Person, read live from Google and never stored. */
export type GmailThread = { accountEmail: string; threadId: string; subject: string; from: string; date: string; snippet: string; messageCount: number }
export type CalendarAttendee = CalendarParticipant & { responseStatus?: string; self?: boolean }

export type CalendarEventSummary = {
  connectionId: string
  accountEmail: string
  calendarId: 'primary'
  recurringEventId?: string
  eventId: string
  sourceId: string
  title: string
  start: string
  end: string
  allDay: boolean
  status: string
  location?: string
  attendees?: CalendarAttendee[]
  organizer?: CalendarParticipant
}

export type CalendarSnapshot = {
  configured: boolean
  connections: CalendarConnection[]
  events: CalendarEventSummary[]
  /** Optional access this build may request; empty until Google verifies the scope. */
  availableAccess?: GoogleAccess[]
}

/** Stable Calendar event identity: account plus event, independent of the connection id. */
export function calendarEventKey(event: Pick<CalendarEventSummary, 'accountEmail' | 'calendarId' | 'eventId'>): string {
  return `${event.accountEmail.trim().toLowerCase()}:${event.calendarId}:${event.eventId}`
}

/** A timed event is upcoming until it ends; an all-day event until the end of its last local day. */
export function calendarEventIsUpcoming(event: CalendarEventSummary, now = new Date()): boolean {
  if (!event.allDay) return Date.parse(event.end) > now.getTime()
  const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return event.end > localDay
}
