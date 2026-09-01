import { shell } from 'electron'
import type { CalendarSnapshot } from '../shared/calendar-contract'
import { createSecureStore } from './electron-secure-store'
import { GoogleCalendarApi } from './google-calendar-api'
import { GoogleCalendarServiceCore, type CalendarDocument } from './google-calendar-service-core'
import { createOAuthRelay } from './oauth-relay'
import { serviceConfig } from './service-config'

const CALENDAR_STORE_FILE = 'google-calendar.enc'
let instance: GoogleCalendarServiceCore | null = null

export function googleCalendarSnapshot(): Promise<CalendarSnapshot> {
  return calendarService().snapshot()
}

export function connectGoogleCalendar(): Promise<CalendarSnapshot> {
  return calendarService().connect()
}

export function syncGoogleCalendar(connectionId: string): Promise<CalendarSnapshot> {
  return calendarService().sync(connectionId)
}

export function disconnectGoogleCalendar(connectionId: string): Promise<CalendarSnapshot> {
  return calendarService().disconnect(connectionId)
}

function calendarService(): GoogleCalendarServiceCore {
  if (instance) return instance
  const config = serviceConfig()
  const relay = config.googleClientId ? createOAuthRelay(config.googleRelayUrl) : null
  const api = new GoogleCalendarApi({
    clientId: config.googleClientId,
    tokenRequester: relay ? (request) => relay.requestTokens(request) : undefined,
    openExternal: (url) => shell.openExternal(url),
  })
  instance = new GoogleCalendarServiceCore(api, createSecureStore<CalendarDocument>(CALENDAR_STORE_FILE))
  return instance
}
