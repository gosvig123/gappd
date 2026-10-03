import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GoogleCalendarApi } from './google-calendar-api.ts'

const NOW = new Date('2026-08-30T14:00:00Z').getTime()
const CLIENT_ID = 'public-client'

test('refreshes through the relay and fetches owned primary events from local midnight', async () => {
  let eventsUrlValue = ''
  const api = new GoogleCalendarApi({
    clientId: CLIENT_ID,
    openExternal: async () => undefined,
    now: () => NOW,
    tokenRequester: async () => ({ accessToken: 'new-access', refreshToken: 'refresh', expiresAt: NOW + 60_000, tokenType: 'Bearer' }),
    fetcher: async (input, init) => {
      eventsUrlValue = String(input)
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer new-access')
      return Response.json({ items: [
        { id: 'event-1', summary: 'Planning', start: { dateTime: '2026-08-30T15:00:00Z' }, end: { dateTime: '2026-08-30T16:00:00Z' } },
        { id: 'cancelled', status: 'cancelled' },
      ] })
    },
  })
  const result = await api.sync('connection-1', 'user@example.com', expiredTokens())
  assert.equal(result.tokens.accessToken, 'new-access')
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].sourceId, 'connection-1:primary:event-1')
  const eventsUrl = new URL(eventsUrlValue)
  assert.equal(eventsUrl.searchParams.get('timeMin'), localMidnight(NOW))
  assert.match(eventsUrl.searchParams.get('fields') || '', /items/)
})

test('Gmail permission is requested only on explicit opt-in and survives refresh without returned scopes', async () => {
  const scope = 'https://www.googleapis.com/auth/gmail.readonly'
  for (const includeGmail of [false, true]) {
    const api = new GoogleCalendarApi({
      clientId: CLIENT_ID,
      tokenRequester: async () => validTokens(),
      fetcher: async () => Response.json({ sub: 'fixture-subject', email: 'fixture@example.com' }),
      openExternal: async input => {
        const url = new URL(input)
        assert.equal(url.searchParams.get('scope')!.split(' ').includes(scope), includeGmail)
        const callback = new URL(url.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', url.searchParams.get('state')!)
        callback.searchParams.set('code', 'synthetic-code')
        await fetch(callback)
      },
    })
    assert.equal((await api.authorize(includeGmail)).subject, 'fixture-subject')
    assert.equal((await api.refresh({ ...expiredTokens(), scope })).scope, scope)
  }
})

test('is not configured without both client ID and relay requester', () => {
  const openExternal = async () => undefined
  assert.equal(new GoogleCalendarApi({ clientId: '', openExternal }).configured(), false)
  assert.equal(new GoogleCalendarApi({ clientId: CLIENT_ID, openExternal }).configured(), false)
})

test('revocation failure does not block local disconnect', async () => {
  const api = new GoogleCalendarApi({
    clientId: CLIENT_ID, openExternal: async () => undefined,
    tokenRequester: async () => expiredTokens(), fetcher: async () => { throw new Error('offline') },
  })
  await assert.doesNotReject(api.revoke(expiredTokens()))
})

function localMidnight(now: number): string {
  const value = new Date(now)
  value.setHours(0, 0, 0, 0)
  return value.toISOString()
}

function expiredTokens() {
  return { accessToken: 'old-access', refreshToken: 'refresh', expiresAt: 0, tokenType: 'Bearer' }
}

const HISTORICAL_START = Date.parse('2025-01-01T12:00:00Z')
const HISTORY_RANGE = { start: HISTORICAL_START, end: HISTORICAL_START + 3_600_000 }

function historicalApi(fetcher: typeof fetch, historyRanges = async () => [HISTORY_RANGE]) {
  return new GoogleCalendarApi({ clientId: CLIENT_ID, now: () => NOW, openExternal: async () => undefined, historyRanges, fetcher })
}

function validTokens() {
  return { ...expiredTokens(), expiresAt: NOW + 3_600_000 }
}

test('paginates historical primary reads with exact bounds and deduplicates IDs', async () => {
  const urls: URL[] = []
  const api = historicalApi(async (input, init) => {
    const url = new URL(String(input)); urls.push(url)
    assert.equal(init?.method ?? 'GET', 'GET')
    assert.match(url.pathname, /calendars\/primary\/events$/)
    if (url.searchParams.get('timeMin') !== new Date(HISTORICAL_START).toISOString()) return Response.json({ items: [] })
    assert.equal(url.searchParams.get('timeMax'), new Date(HISTORY_RANGE.end).toISOString())
    const item = { id: 'past', start: { dateTime: new Date(HISTORICAL_START).toISOString() }, end: { dateTime: new Date(HISTORY_RANGE.end).toISOString() } }
    return Response.json({ items: [item], nextPageToken: url.searchParams.has('pageToken') ? undefined : 'second' })
  })
  const result = await api.sync('connection', 'me@example.com', validTokens())
  assert.equal(urls.length, 3)
  assert.equal(result.historicalEvents?.length, 1)
  assert.deepEqual(result.historyRanges, [HISTORY_RANGE])
  assert.equal(result.historyError, undefined)
})

test('historical offline and range overflow errors do not discard upcoming events', async () => {
  for (const rangeFailure of [false, true]) {
    let calls = 0
    const api = historicalApi(async () => {
      if (++calls > 1) throw new Error('offline')
      return Response.json({ items: [{ id: 'upcoming', start: { dateTime: '2026-09-01T12:00:00Z' }, end: { dateTime: '2026-09-01T13:00:00Z' } }] })
    }, async () => { if (rangeFailure) throw new Error('120 ranges'); return [HISTORY_RANGE] })
    const result = await api.sync('connection', 'me@example.com', validTokens())
    assert.equal(result.events.length, 1)
    assert.equal(result.historicalEvents, undefined)
    assert.match(result.historyError ?? '', /Calendar history incomplete/)
  }
})

test('rejects partial history after 20 pages per range instead of looping forever', async () => {
  let calls = 0
  const api = historicalApi(async () => Response.json(++calls === 1 ? { items: [] } : { items: [], nextPageToken: 'repeated' }))
  const result = await api.sync('connection', 'me@example.com', validTokens())
  assert.equal(calls, 21)
  assert.equal(result.historicalEvents, undefined)
  assert.match(result.historyError ?? '', /pagination limit/)
})

test('caps total historical pages at 200 across ranges', async () => {
  let calls = 0
  const api = historicalApi(async (input) => {
    calls++
    const url = new URL(String(input))
    const page = Number(url.searchParams.get('pageToken') ?? 1)
    const historical = url.searchParams.get('timeMin') !== localMidnight(NOW)
    return Response.json({ items: [], nextPageToken: historical && page < 20 ? String(page + 1) : undefined })
  }, async () => Array.from({ length: 11 }, (_, index) => ({ start: HISTORY_RANGE.start + index * 86_400_000, end: HISTORY_RANGE.end + index * 86_400_000 })))
  const result = await api.sync('connection', 'me@example.com', validTokens())
  assert.equal(calls, 201)
  assert.equal(result.historicalEvents, undefined)
  assert.match(result.historyError ?? '', /pagination limit/)
})
