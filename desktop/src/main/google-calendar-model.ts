import type { CalendarEventSummary } from '../shared/calendar-contract'

const PRIMARY_CALENDAR_ID = 'primary'
const CANCELLED_STATUS = 'cancelled'
const CONFIRMED_STATUS = 'confirmed'
const UNTITLED_EVENT = 'Untitled event'

export type GoogleEventItem = {
  id?: string
  status?: string
  summary?: string
  location?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
}

export function mapGoogleEvent(item: GoogleEventItem, connectionId: string, accountEmail: string): CalendarEventSummary | null {
  if (!item.id || item.status === CANCELLED_STATUS) return null
  const start = item.start?.dateTime || item.start?.date
  const end = item.end?.dateTime || item.end?.date
  if (!start || !end) return null
  return {
    connectionId,
    accountEmail,
    calendarId: PRIMARY_CALENDAR_ID,
    eventId: item.id,
    sourceId: `${connectionId}:${PRIMARY_CALENDAR_ID}:${item.id}`,
    title: item.summary?.trim() || UNTITLED_EVENT,
    start,
    end,
    allDay: Boolean(item.start?.date && !item.start?.dateTime),
    status: item.status || CONFIRMED_STATUS,
    location: item.location?.trim() || undefined,
  }
}
