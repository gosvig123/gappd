import type { CalendarRange } from './calendar-history-ranges'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GMAIL_READ_SCOPE } from './agenda-communication.ts'
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
const EVENT_FIELDS = 'nextPageToken,items(id,recurringEventId,status,summary,location,start,end,attendees(email,displayName,responseStatus,self,resource),organizer(email,displayName))'
const SYNC_DAYS = 30
const MAX_PAGES_PER_RANGE = 20
const MAX_HISTORY_PAGES = 200
const REQUEST_TIMEOUT_MS = 10_000

export type GoogleAuthorizedAccount = { subject: string; email: string; tokens: OAuthTokenSet }
export type GoogleSyncResult = { tokens: OAuthTokenSet; events: CalendarEventSummary[]; historicalEvents?: CalendarEventSummary[]; historyRanges?: CalendarRange[]; historyError?: string }
export type GoogleCalendarApiOptions = {
  clientId: string
  tokenRequester?: OAuthTokenRequester
  openExternal(url: string): Promise<unknown>
  fetcher?: typeof fetch
  historyRanges?: () => Promise<CalendarRange[]>
  now?: () => number
}

export class GoogleCalendarApi {
  private readonly clientId: string
  private readonly tokenRequester?: OAuthTokenRequester
  private readonly openExternal: (url: string) => Promise<unknown>
  private readonly fetcher: typeof fetch
  private readonly historyRanges: () => Promise<CalendarRange[]>
  private readonly now: () => number

  constructor(options: GoogleCalendarApiOptions) {
    this.historyRanges = options.historyRanges ?? (async () => [])
    this.clientId = options.clientId
    this.tokenRequester = options.tokenRequester
    this.openExternal = options.openExternal
    this.fetcher = options.fetcher || fetch
    this.now = options.now || Date.now
  }

  configured(): boolean {
    return Boolean(this.clientId && this.tokenRequester)
  }

  async authorize(includeGmail = false): Promise<GoogleAuthorizedAccount> {
    const config = this.oauthConfig()
    if (includeGmail) config.scopes = [...config.scopes, GMAIL_READ_SCOPE]
    const tokens = await authorizeOAuth(config, {
      openExternal: this.openExternal,
      tokenRequester: this.requiredTokenRequester(),
    })
    return { ...await this.fetchProfile(tokens), tokens }
  }

  async sync(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<GoogleSyncResult> {
    const currentTokens = await this.refresh(tokens)
    const events = await this.fetchEvents(connectionId, email, currentTokens)
    const history = await this.fetchHistory(connectionId, email, currentTokens)
    return { tokens: currentTokens, events, ...history }
  }

  async refresh(tokens: OAuthTokenSet): Promise<OAuthTokenSet> {
    if (!needsTokenRefresh(tokens, this.now())) return tokens
    const refreshed = await refreshOAuthToken(this.oauthConfig(), tokens, this.fetcher, this.now, this.requiredTokenRequester())
    return { ...refreshed, scope: refreshed.scope ?? tokens.scope }
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

  private async fetchEvents(connectionId: string, email: string, tokens: OAuthTokenSet, range?: CalendarRange, budget = { remaining: MAX_PAGES_PER_RANGE }): Promise<CalendarEventSummary[]> {
    const events: CalendarEventSummary[] = []
    let pageToken: string | undefined
    let pages = 0
    do {
      if (++pages > MAX_PAGES_PER_RANGE || --budget.remaining < 0) throw new Error('Calendar pagination limit exceeded; synchronization is incomplete.')
      const page = await this.fetchEventPage(tokens, pageToken, range)
      for (const item of page.items || []) {
        const event = mapGoogleEvent(item, connectionId, email)
        if (event) events.push(event)
      }
      pageToken = page.nextPageToken
    } while (pageToken)
    return events.sort((left, right) => left.start.localeCompare(right.start))
  }

  private async fetchHistory(connectionId: string, email: string, tokens: OAuthTokenSet): Promise<Pick<GoogleSyncResult, 'historicalEvents' | 'historyRanges' | 'historyError'>> {
    try {
      const events = new Map<string, CalendarEventSummary>()
      const budget = { remaining: MAX_HISTORY_PAGES }
      const historyRanges = await this.historyRanges()
      for (const range of historyRanges) {
        for (const event of await this.fetchEvents(connectionId, email, tokens, range, budget)) events.set(event.sourceId, event)
      }
      return { historicalEvents: [...events.values()], historyRanges }
    } catch (error) {
      return { historyError: `Calendar history incomplete: ${error instanceof Error ? error.message : 'request failed'}`.slice(0, 240) }
    }
  }

  private async fetchEventPage(tokens: OAuthTokenSet, pageToken?: string, range?: CalendarRange): Promise<GoogleEventPage> {
    const response = await this.fetcher(upcomingEventsUrl(this.now(), pageToken, range), { headers: bearerHeaders(tokens), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`Google Calendar synchronization failed (${response.status}).`)
    return response.json() as Promise<GoogleEventPage>
  }
}

type GoogleEventPage = { items?: GoogleEventItem[]; nextPageToken?: string }

function upcomingEventsUrl(now: number, pageToken?: string, range?: CalendarRange): string {
  const url = new URL(GOOGLE_EVENTS_URL)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + SYNC_DAYS * 24 * 60 * 60 * 1000)
  const params = { timeMin: range ? new Date(range.start).toISOString() : start.toISOString(), timeMax: range ? new Date(range.end).toISOString() : end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', fields: EVENT_FIELDS }
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
