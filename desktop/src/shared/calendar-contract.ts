export type CalendarConnection = {
  id: string
  email: string
  status: 'ready' | 'syncing' | 'error'
  lastSyncedAt?: string
  error?: string
}

export type CalendarEventSummary = {
  connectionId: string
  accountEmail: string
  calendarId: 'primary'
  eventId: string
  sourceId: string
  title: string
  start: string
  end: string
  allDay: boolean
  status: string
  location?: string
}

export type CalendarSnapshot = {
  configured: boolean
  connections: CalendarConnection[]
  events: CalendarEventSummary[]
}
