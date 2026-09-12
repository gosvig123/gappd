import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection } from './slack-connection.ts'
import type { SlackTokenSet } from './slack-oauth.ts'

const CLIENT_ID = '1234567890.1234567890'
const NOW = 1_788_000_000_000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

test('a connect that finishes after disconnect does not store tokens', async () => {
  const store = memoryStore(tokens())
  const authorizationStarted = deferred<void>()
  const finishAuthorization = deferred<void>()
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: async (url) => {
      authorizationStarted.resolve()
      await finishAuthorization.promise
      await completeBrowserAuthorization(url)
    },
    fetcher: async () => slackUserPayload(),
    now: () => NOW,
    callbackPort: 0,
  })
  const connecting = connection.connect()
  await authorizationStarted.promise
  await connection.disconnect()
  finishAuthorization.resolve()
  await assert.rejects(connecting, /disconnected during connect/)
  assert.equal(store.state.value, null)
  assert.equal(store.state.writes.length, 0)
})

test('a disconnect during the connect write is not undone by the write', async () => {
  const store = gatedStore(null, 'write')
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: completeBrowserAuthorization,
    fetcher: async () => slackUserPayload(),
    now: () => NOW,
    callbackPort: 0,
  })
  const connecting = connection.connect()
  await store.started.promise
  const disconnecting = connection.disconnect()
  store.release()
  await assert.rejects(connecting, /disconnected during connect/)
  await disconnecting
  assert.equal(store.state.value, null)
  assert.equal(store.state.writes.length, 1)
  assert.equal(store.state.clears, 1)
})

test('a stale rotation does not clear the refresh of a newer connection', async () => {
  let currentNow = NOW
  const store = memoryStore(tokens({ expiresAt: NOW + 60_000 }))
  const gates = refreshGates()
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: completeBrowserAuthorization,
    fetcher: gates.fetcher,
    now: () => currentNow,
    callbackPort: 0,
  })
  const stale = connection.accessToken()
  await gates.staleStarted.promise
  await connection.disconnect()
  await connection.connect()
  currentNow = NOW + 44_000_000
  const current = connection.accessToken()
  await gates.currentStarted.promise
  gates.staleRefresh.resolve(slackUserPayload())
  await assert.rejects(stale, /disconnected during refresh/)
  const joined = connection.accessToken()
  gates.currentRefresh.resolve(slackUserPayload())
  assert.deepEqual(await Promise.all([current, joined]), ['xoxe.xoxp-1-new', 'xoxe.xoxp-1-new'])
  assert.deepEqual(gates.refreshTokens, ['xoxe-1-old', 'xoxe-1-new'])
})

test('a request from the previous connection cannot clear the new connection', async () => {
  const store = gatedStore(tokens({ expiresAt: NOW + 60_000 }), 'read')
  let refreshFetches = 0
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: completeBrowserAuthorization,
    fetcher: async (_url, init) => {
      if (parseBody(init).get('grant_type') === 'authorization_code') return slackUserPayload()
      refreshFetches += 1
      return Response.json({ ok: false, error: 'invalid_refresh_token' })
    },
    now: () => NOW,
    callbackPort: 0,
  })
  const stale = connection.accessToken()
  await store.started.promise
  const disconnecting = connection.disconnect()
  const reconnecting = connection.connect()
  store.release()
  await assert.rejects(stale, /disconnected during refresh/)
  await disconnecting
  await reconnecting
  assert.equal(refreshFetches, 0)
  assert.equal(store.state.clears, 1)
  assert.equal(store.state.value?.accessToken, 'xoxe.xoxp-1-new')
})

function refreshGates() {
  const staleRefresh = deferred<Response>()
  const currentRefresh = deferred<Response>()
  const staleStarted = deferred<void>()
  const currentStarted = deferred<void>()
  const refreshTokens: string[] = []
  const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = parseBody(init)
    if (body.get('grant_type') === 'authorization_code') return slackUserPayload()
    const token = body.get('refresh_token') || ''
    refreshTokens.push(token)
    if (token === 'xoxe-1-old') { staleStarted.resolve(); return staleRefresh.promise }
    if (refreshTokens.length === 2) { currentStarted.resolve(); return currentRefresh.promise }
    return slackUserPayload()
  }
  return { fetcher, refreshTokens, staleRefresh, currentRefresh, staleStarted, currentStarted }
}

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

function gatedStore(initial: SlackTokenSet | null, gate: 'read' | 'write') {
  const state = { value: initial, writes: [] as SlackTokenSet[], clears: 0 }
  const started = deferred<void>()
  const release = deferred<void>()
  const pause = async () => { started.resolve(); await release.promise }
  return {
    state,
    started,
    read: async () => { if (gate === 'read') await pause(); return state.value },
    write: async (value: SlackTokenSet) => { if (gate === 'write') await pause(); state.value = value; state.writes.push(value) },
    clear: async () => { state.value = null; state.clears += 1 },
    release: () => release.resolve(),
  }
}

async function completeBrowserAuthorization(url: string): Promise<void> {
  const authorization = new URL(url)
  const callback = new URL(authorization.searchParams.get('redirect_uri') || '')
  callback.searchParams.set('code', 'slack-code')
  callback.searchParams.set('state', authorization.searchParams.get('state') || '')
  await fetch(callback)
}

function parseBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body))
}

function slackUserPayload(): Response {
  return Response.json({
    ok: true,
    team: { id: 'T0C19BLLJBX', name: 'gappd' },
    authed_user: { id: 'U00000001', scope: 'chat:write', access_token: 'xoxe.xoxp-1-new', expires_in: 43_200, refresh_token: 'xoxe-1-new', token_type: 'user' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
