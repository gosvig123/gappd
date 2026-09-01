import type { CalendarEventSummary } from '../shared/calendar-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { mapGoogleEvent, type GoogleEventItem } from './google-calendar-model.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeOAuth, needsTokenRefresh, refreshOAuthToken, type OAuthConfig, type OAuthTokenRequester, type OAuthTokenSet } from './oauth.ts'

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.owned.readonly']
const EVENT_FIELDS = 'nextPageToken,items(id,status,summary,location,start,end)'
const SYNC_DAYS = 30
const REQUEST_TIMEOUT_MS = 10_000

export type GoogleAuthorizedAccount = { subject: string; email: string; tokens: OAuthTokenSet }
export type GoogleSyncResult = { tokens: OAuthTokenSet; events: CalendarEventSummary[] }
export type GoogleCalendarApiOptions = {
  clientId: string
  tokenRequester?: OAuthTokenRequester
  openExternal(url: string): Promise<unknown>
  fetcher?: typeof fetch
  now?: () => number
}

export class GoogleCalendarApi {
  private readonly clientId: string
  private readonly tokenRequester?: OAuthTokenRequester
  private readonly openExternal: (url: string) => Promise<unknown>
  private readonly fetcher: typeof fetch
  private readonly now: () => number

  constructor(options: GoogleCalendarApiOptions) {
    this.clientId = options.clientId
    this.tokenRequester = options.tokenRequester
    this.openExternal = options.openExternal
    this.fetcher = options.fetcher || fetch
    this.now = options.now || Date.now
  }

  configured(): boolean {
    return Boolean(this.clientId && this.tokenRequester)
  }

  async authorize(): Promise<GoogleAuthorizedAccount> {
    const tokens = await authorizeOAuth(this.oauthConfig(), {
      openExternal: this.openExternal,
      tokenRequester: this.requiredTokenRequester(),
    })
    return { ...await this.fetchProfile(tokens), tokens }
  }

  async sync(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<GoogleSyncResult> {
    const currentTokens = needsTokenRefresh(tokens, this.now())
      ? await refreshOAuthToken(this.oauthConfig(), tokens, this.fetcher, this.now, this.requiredTokenRequester())
      : tokens
    return { tokens: currentTokens, events: await this.fetchEvents(connectionId, email, currentTokens) }
  }

  async revoke(tokens: OAuthTokenSet): Promise<void> {
    const token = tokens.refreshToken || tokens.accessToken
    try {
      await this.fetcher(GOOGLE_REVOKE_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch { /* Local disconnect must still succeed. */ }
  }

  private oauthConfig(): OAuthConfig {
    if (!this.configured()) throw new Error('Google Calendar is not configured for this build.')
    return {
      clientId: this.clientId, authorizeUrl: GOOGLE_AUTHORIZE_URL, tokenUrl: GOOGLE_TOKEN_URL,
      scopes: GOOGLE_SCOPES, callbackPath: '',
      authorizeParams: { access_type: 'offline', prompt: 'consent select_account' },
    }
  }

  private requiredTokenRequester(): OAuthTokenRequester {
    if (!this.tokenRequester) throw new Error('Google Calendar is not configured for this build.')
    return this.tokenRequester
  }

  private async fetchProfile(tokens: OAuthTokenSet): Promise<{ subject: string; email: string }> {
    const response = await this.fetcher(GOOGLE_USERINFO_URL, { headers: bearerHeaders(tokens) })
    if (!response.ok) throw new Error(`Google profile request failed (${response.status}).`)
    const value = await response.json() as Record<string, unknown>
    return { subject: requiredString(value.sub, 'Google account ID'), email: requiredString(value.email, 'Google account email') }
  }

  private async fetchEvents(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<CalendarEventSummary[]> {
    const events: CalendarEventSummary[] = []
    let pageToken: string | undefined
    do {
      const page = await this.fetchEventPage(tokens, pageToken)
      for (const item of page.items || []) {
        const event = mapGoogleEvent(item, connectionId, email)
        if (event) events.push(event)
      }
      pageToken = page.nextPageToken
    } while (pageToken)
    return events.sort((left, right) => left.start.localeCompare(right.start))
  }

  private async fetchEventPage(tokens: OAuthTokenSet, pageToken?: string): Promise<GoogleEventPage> {
    const response = await this.fetcher(upcomingEventsUrl(this.now(), pageToken), { headers: bearerHeaders(tokens) })
    if (!response.ok) throw new Error(`Google Calendar synchronization failed (${response.status}).`)
    return response.json() as Promise<GoogleEventPage>
  }
}

type GoogleEventPage = { items?: GoogleEventItem[]; nextPageToken?: string }

function upcomingEventsUrl(now: number, pageToken?: string): string {
  const url = new URL(GOOGLE_EVENTS_URL)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + SYNC_DAYS * 24 * 60 * 60 * 1000)
  const params = { timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', fields: EVENT_FIELDS }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

function bearerHeaders(tokens: OAuthTokenSet): { authorization: string } {
  return { authorization: `Bearer ${tokens.accessToken}` }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} was missing.`)
  return value
}
