import { requestCommand } from '../app-protocol'
import { historicalCalendarRanges } from './calendar-history-ranges'
import { app, shell } from 'electron'
import type { CalendarParticipant, CalendarSnapshot, GmailThread, GoogleAccess } from '../../shared/calendar-contract'
import { reviewGoogleAccess } from './google-access'
import { createSecureStore } from '../electron-secure-store'
import { GoogleCalendarApi } from './calendar-api'
import { GoogleCalendarServiceCore, type CalendarDocument } from './calendar-service-core'
import { serviceConfig } from '../service-config'
import { selectedFixtureCalendar, selectedFixtureContacts, selectedFixtureGmailThreads } from './fixture-calendar'
import { fetchGmailThreads, gmailThreadUrl, GMAIL_THREAD_LIMIT } from './gmail-threads'
import { fetchGoogleContacts } from './google-contacts'
import { selectedFixtureProfile } from '../selected-fixture-profile'

const CALENDAR_STORE_FILE = 'google-calendar.enc'
let instance: GoogleCalendarServiceCore | null = null

export function googleCalendarSnapshot(): Promise<CalendarSnapshot> {
  if (selectedFixtureProfile()) return Promise.resolve(selectedFixtureCalendar(googleReviewAccess()))
  return calendarService().snapshot()
}

export function connectGoogleCalendar(access: GoogleAccess[]): Promise<CalendarSnapshot> {
  return calendarService().connect(access)
}

/** Saved contacts of every account that granted Contacts access, one entry per email. */
export async function googleContacts(): Promise<CalendarParticipant[]> {
  if (selectedFixtureProfile()) return googleReviewAccess().includes('contacts') ? selectedFixtureContacts() : []
  const accounts = await calendarService().accessTokens('contacts')
  if (!accounts.length) throw new Error('No Google account has Contacts access. In Settings → Google Calendar, add Contacts access first.')
  const contacts = new Map<string, CalendarParticipant>()
  for (const account of accounts) {
    for (const contact of await fetchGoogleContacts(account.accessToken)) {
      const email = contact.email.toLowerCase()
      if (!contacts.has(email) || (!contacts.get(email)!.name && contact.name)) contacts.set(email, contact)
    }
  }
  return [...contacts.values()]
}

/** Saves every Google contact with an email who is not already a Person. */
export async function importGoogleContacts() {
  return requestCommand('meetings.importPeople', { contacts: JSON.stringify(await googleContacts()) })
}

/** The latest Gmail threads with one email address across every account that granted Gmail access. */
export async function gmailThreads(personEmail: string): Promise<GmailThread[]> {
  if (selectedFixtureProfile()) return googleReviewAccess().includes('gmail') ? selectedFixtureGmailThreads(personEmail) : []
  const accounts = await calendarService().accessTokens('gmail')
  if (!accounts.length) throw new Error('No Google account has Gmail access. In Settings → Google Calendar, add Gmail access first.')
  const threads = (await Promise.all(accounts.map((account) => fetchGmailThreads(account.accessToken, account.email, personEmail)))).flat()
  return threads.sort((left, right) => right.date.localeCompare(left.date)).slice(0, GMAIL_THREAD_LIMIT)
}

export async function openGmailThread(accountEmail: string, threadId: string): Promise<void> {
  if (selectedFixtureProfile()) return
  await shell.openExternal(gmailThreadUrl(accountEmail, threadId), { activate: true })
}

/** Optional Google access this run may request; see `reviewGoogleAccess`. */
export function googleReviewAccess(): GoogleAccess[] {
  return reviewGoogleAccess(app.isPackaged, process.env)
}

export function syncGoogleCalendar(connectionId: string): Promise<CalendarSnapshot> {
  return calendarService().sync(connectionId)
}

export function disconnectGoogleCalendar(connectionId: string): Promise<CalendarSnapshot> {
  return calendarService().disconnect(connectionId)
}

export function backgroundSyncGoogleCalendar(): Promise<void> {
  if (selectedFixtureProfile()) return Promise.resolve()
  return calendarService().backgroundSync()
}

export function onGoogleCalendarChange(listener: (snapshot: CalendarSnapshot) => void): () => void {
  if (selectedFixtureProfile()) return () => undefined
  return calendarService().subscribe(listener)
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
  instance = new GoogleCalendarServiceCore(api, createSecureStore<CalendarDocument>(CALENDAR_STORE_FILE), undefined, googleReviewAccess())
  return instance
}
