import { requestCommand } from '../app-protocol'
import { historicalCalendarRanges } from './calendar-history-ranges'
import { shell } from 'electron'
import type { CalendarSnapshot } from '../../shared/calendar-contract'
import { createSecureStore } from '../electron-secure-store'
import { GoogleCalendarApi } from './calendar-api'
import { GoogleCalendarServiceCore, type CalendarDocument } from './calendar-service-core'
import { serviceConfig } from '../service-config'
import { selectedFixtureCalendar } from './fixture-calendar'
import { selectedFixtureProfile } from '../selected-fixture-profile'

const CALENDAR_STORE_FILE = 'google-calendar.enc'
let instance: GoogleCalendarServiceCore | null = null

export function googleCalendarSnapshot(): Promise<CalendarSnapshot> {
  if (selectedFixtureProfile()) return Promise.resolve(selectedFixtureCalendar())
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
  const api = new GoogleCalendarApi({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    historyRanges: async () => historicalCalendarRanges((await requestCommand('meetings.times', {})).meetings),
    openExternal: (url) => shell.openExternal(url),
  })
  instance = new GoogleCalendarServiceCore(api, createSecureStore<CalendarDocument>(CALENDAR_STORE_FILE))
  return instance
}
