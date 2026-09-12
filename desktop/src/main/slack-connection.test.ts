import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection } from './slack-connection.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackReconnectError, type SlackTokenSet } from './slack-oauth.ts'

const CLIENT_ID = '1234567890.1234567890'
const NOW = 1_788_000_000_000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

test('connect stores the authorized token set', async () => {
  const store = memoryStore(null)
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: completeBrowserAuthorization,
    fetcher: async () => slackUserPayload(),
    now: () => NOW,
    callbackPort: 0,
  })
  const connected = await connection.connect()
  assert.equal(connected.refreshToken, 'xoxe-1-new')
  assert.equal(store.state.value?.accessToken, 'xoxe.xoxp-1-new')
  assert.equal(store.state.writes.length, 1)
})

test('returns the stored access token while it is fresh', async () => {
  const store = memoryStore(tokens())
  let fetches = 0
  const connection = new SlackConnection(CLIENT_ID, store, { openExternal: async () => undefined, fetcher: async () => { fetches += 1; return slackUserPayload() }, now: () => NOW })
  assert.equal(await connection.accessToken(), 'xoxe.xoxp-1-old')
  assert.equal(fetches, 0)
  assert.equal(store.state.writes.length, 0)
})

test('refreshes an expiring token and persists the rotated pair before use', async () => {
  const store = memoryStore(tokens({ expiresAt: NOW + 60_000 }))
  const connection = new SlackConnection(CLIENT_ID, store, { openExternal: async () => undefined, fetcher: async () => slackUserPayload(), now: () => NOW })
  assert.equal(await connection.accessToken(), 'xoxe.xoxp-1-new')
  assert.equal(store.state.writes.length, 1)
  assert.equal(store.state.writes[0]?.refreshToken, 'xoxe-1-new')
  assert.equal(store.state.value?.accessToken, 'xoxe.xoxp-1-new')
  assert.equal(store.state.value?.expiresAt, NOW + 43_200_000)
})

test('serializes concurrent refreshes into one rotation', async () => {
  const store = memoryStore(tokens({ expiresAt: NOW + 60_000 }))
  let fetches = 0
  const connection = new SlackConnection(CLIENT_ID, store, { openExternal: async () => undefined, fetcher: async () => { fetches += 1; return slackUserPayload() }, now: () => NOW })
  const values = await Promise.all([connection.accessToken(), connection.accessToken(), connection.accessToken()])
  assert.deepEqual(values, ['xoxe.xoxp-1-new', 'xoxe.xoxp-1-new', 'xoxe.xoxp-1-new'])
  assert.equal(fetches, 1)
  assert.equal(store.state.writes.length, 1)
})

test('clears the connection when Slack rejects the refresh token', async () => {
  const store = memoryStore(tokens({ expiresAt: NOW + 60_000 }))
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: async () => undefined,
    fetcher: async () => Response.json({ ok: false, error: 'invalid_refresh_token' }),
    now: () => NOW,
  })
  await assert.rejects(connection.accessToken(), (error: unknown) => error instanceof SlackReconnectError)
  assert.equal(store.state.clears, 1)
  assert.equal(store.state.value, null)
})

test('does not resurrect a connection disconnected during refresh', async () => {
  const store = memoryStore(tokens({ expiresAt: NOW + 60_000 }))
  const pending = deferred<Response>()
  const started = deferred<void>()
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: async () => undefined,
    fetcher: () => { started.resolve(); return pending.promise },
    now: () => NOW,
  })
  const refresh = connection.accessToken()
  await started.promise
  await connection.disconnect()
  pending.resolve(slackUserPayload())
  await assert.rejects(refresh, /disconnected during refresh/)
  assert.equal(store.state.value, null)
  assert.equal(store.state.writes.length, 0)
})

test('disconnect clears the stored token set', async () => {
  const store = memoryStore(tokens())
  const connection = new SlackConnection(CLIENT_ID, store, { openExternal: async () => undefined, now: () => NOW })
  await connection.disconnect()
  assert.equal(store.state.value, null)
  await assert.rejects(connection.accessToken(), /not connected/)
})

function tokens(overrides: Partial<SlackTokenSet> = {}): SlackTokenSet {
  return {
    accessToken: 'xoxe.xoxp-1-old',
    refreshToken: 'xoxe-1-old',
    expiresAt: NOW + 10 * 60 * 1000,
    refreshExpiresAt: NOW + THIRTY_DAYS_MS,
    scope: 'chat:write',
    teamId: 'T0C19BLLJBX',
    userId: 'U00000001',
    ...overrides,
  }
}

function memoryStore(initial: SlackTokenSet | null) {
  const state = { value: initial, writes: [] as SlackTokenSet[], clears: 0 }
  return {
    state,
    read: async () => state.value,
    write: async (value: SlackTokenSet) => { state.value = value; state.writes.push(value) },
    clear: async () => { state.value = null; state.clears += 1 },
  }
}

async function completeBrowserAuthorization(url: string): Promise<void> {
  const authorization = new URL(url)
  const callback = new URL(authorization.searchParams.get('redirect_uri') || '')
  callback.searchParams.set('code', 'slack-code')
  callback.searchParams.set('state', authorization.searchParams.get('state') || '')
  await fetch(callback)
}

function slackUserPayload(): Response {
  return Response.json({
    ok: true,
    app_id: 'A0C1C2FVC78',
    team: { id: 'T0C19BLLJBX', name: 'gappd' },
    authed_user: {
      id: 'U00000001',
      scope: 'chat:write',
      access_token: 'xoxe.xoxp-1-new',
      expires_in: 43_200,
      refresh_token: 'xoxe-1-new',
      token_type: 'user',
    },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
