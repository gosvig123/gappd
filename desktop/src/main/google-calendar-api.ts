import { shell } from 'electron'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import { mapGoogleEvent, type GoogleEventItem } from './google-calendar-model'
import { authorizeOAuth, needsTokenRefresh, refreshOAuthToken, type OAuthConfig, type OAuthTokenSet } from './oauth'
import { serviceConfig } from './service-config'

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.owned.readonly']
const SYNC_DAYS = 30
const REVOKE_TIMEOUT_MS = 10_000

export type GoogleAuthorizedAccount = { subject: string; email: string; tokens: OAuthTokenSet }
export type GoogleSyncResult = { tokens: OAuthTokenSet; events: CalendarEventSummary[] }

export async function authorizeGoogleAccount(): Promise<GoogleAuthorizedAccount> {
  const config = googleOAuthConfig()
  if (!config) throw new Error('Google Calendar is not configured for this build.')
  const tokens = await authorizeOAuth(config, { openExternal: (url) => shell.openExternal(url) })
  const profile = await fetchGoogleProfile(tokens)
  return { ...profile, tokens }
}

export async function fetchGoogleCalendar(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<GoogleSyncResult> {
  const config = googleOAuthConfig()
  if (!config) throw new Error('Google Calendar is not configured for this build.')
  const currentTokens = needsTokenRefresh(tokens) ? await refreshOAuthToken(config, tokens) : tokens
  const events = await fetchEventPages(connectionId, email, currentTokens)
  return { tokens: currentTokens, events }
}

export function googleCalendarConfigured(): boolean {
  return Boolean(googleOAuthConfig())
}

export async function revokeGoogleAuthorization(tokens: OAuthTokenSet): Promise<void> {
  const token = tokens.refreshToken || tokens.accessToken
  try {
    await fetch(GOOGLE_REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS) })
  } catch { /* Local disconnect must still succeed. */ }
}

async function fetchGoogleProfile(tokens: OAuthTokenSet): Promise<{ subject: string; email: string }> {
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: bearerHeaders(tokens) })
  if (!response.ok) throw new Error(`Google profile request failed (${response.status}).`)
  const value = await response.json() as Record<string, unknown>
  return { subject: requiredString(value.sub, 'Google account ID'), email: requiredString(value.email, 'Google account email') }
}

async function fetchEventPages(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<CalendarEventSummary[]> {
  const events: CalendarEventSummary[] = []
  let pageToken: string | undefined
  do {
    const page = await fetchEventPage(tokens, pageToken)
    for (const item of page.items || []) {
      const mapped = mapGoogleEvent(item, connectionId, email)
      if (mapped) events.push(mapped)
    }
    pageToken = page.nextPageToken
  } while (pageToken)
  return events.sort((left, right) => left.start.localeCompare(right.start))
}

async function fetchEventPage(tokens: OAuthTokenSet, pageToken?: string): Promise<{ items?: GoogleEventItem[]; nextPageToken?: string }> {
  const url = upcomingEventsUrl(pageToken)
  const response = await fetch(url, { headers: bearerHeaders(tokens) })
  if (!response.ok) throw new Error(`Google Calendar synchronization failed (${response.status}).`)
  return response.json() as Promise<{ items?: GoogleEventItem[]; nextPageToken?: string }>
}

function upcomingEventsUrl(pageToken?: string): string {
  const url = new URL(GOOGLE_EVENTS_URL)
  const now = new Date()
  const end = new Date(now.getTime() + SYNC_DAYS * 24 * 60 * 60 * 1000)
  const params = { timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

function googleOAuthConfig(): OAuthConfig | null {
  const clientId = serviceConfig().googleClientId
  if (!clientId) return null
  return { clientId, authorizeUrl: GOOGLE_AUTHORIZE_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: GOOGLE_SCOPES, callbackPath: '', authorizeParams: { access_type: 'offline', prompt: 'consent select_account' } }
}

function bearerHeaders(tokens: OAuthTokenSet): { authorization: string } {
  return { authorization: `Bearer ${tokens.accessToken}` }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} was missing.`)
  return value
}
