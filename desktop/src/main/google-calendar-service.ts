import { requestCommand } from './app-protocol'
import { gmailAgenda } from './gmail-agenda'
import type { CommunicationPeriod } from './agenda-communication'
import { historicalCalendarRanges } from './calendar-history-ranges'
import { app, shell } from 'electron'
import type { CalendarSnapshot } from '../shared/calendar-contract'
import { createSecureStore } from './electron-secure-store'
import { GoogleCalendarApi } from './google-calendar-api'
import { GoogleCalendarServiceCore, type CalendarDocument } from './google-calendar-service-core'
import { serviceConfig } from './service-config'
import { selectedFixtureCalendar } from './selected-fixture-calendar'
import { selectedFixtureProfile } from './selected-fixture-profile'

const CALENDAR_STORE_FILE = 'google-calendar.enc'
let instance: GoogleCalendarServiceCore | null = null

export function googleCalendarPendingSyncIds(): string[] {
  return calendarService().pendingSyncIds()
}

export function googleCalendarSnapshot(): Promise<CalendarSnapshot> {
  if (selectedFixtureProfile()) return Promise.resolve(selectedFixtureCalendar())
  return calendarService().snapshot()
}

export function connectGoogleCalendar(includeGmail = false): Promise<CalendarSnapshot> {
  return calendarService().connect(includeGmail)
}

export function googleAgendaCommunication(connectionId: string, emails: string[], before: CommunicationPeriod) {
  return calendarService().agendaCommunication(connectionId, (token, subject) => gmailAgenda(token, subject, emails, before))
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
    historyRanges: async () => historicalCalendarRanges((await requestCommand('meetings.agendaHistory', {})).meetings),
    openExternal: (url) => shell.openExternal(url),
  })
  instance = new GoogleCalendarServiceCore(api, createSecureStore<CalendarDocument>(CALENDAR_STORE_FILE), undefined, gmailReviewEnabled())
  return instance
}

/** Gmail is unverified by Google, so only unpackaged development runs may request it, for the verification demo. */
function gmailReviewEnabled(): boolean {
  return !app.isPackaged && process.env.GAPPD_GMAIL_REVIEW === '1'
}
