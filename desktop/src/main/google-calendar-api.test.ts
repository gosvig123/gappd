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
  const expectedStart = new Date(NOW)
  expectedStart.setHours(0, 0, 0, 0)
  assert.equal(eventsUrl.searchParams.get('timeMin'), expectedStart.toISOString())
  assert.match(eventsUrl.searchParams.get('fields') || '', /items/)
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

function expiredTokens() {
  return { accessToken: 'old-access', refreshToken: 'refresh', expiresAt: 0, tokenType: 'Bearer' }
}
