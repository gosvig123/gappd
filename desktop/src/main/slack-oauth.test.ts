import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeSlack, parseSlackTokens, refreshSlackTokens, SlackReconnectError, SLACK_REDIRECT_URI, SLACK_USER_SCOPES } from './slack-oauth.ts'

const CLIENT_ID = '1234567890.1234567890'
const NOW = 1_788_000_000_000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

test('runs the PKCE loopback flow without a client secret', async () => {
  let tokenBody = ''
  const tokens = await authorizeSlack(CLIENT_ID, {
    openExternal: async (url) => {
      const authorization = new URL(url)
      assert.equal(authorization.origin + authorization.pathname, 'https://slack.com/oauth/v2/authorize')
      assert.equal(authorization.searchParams.get('client_id'), CLIENT_ID)
      assert.equal(authorization.searchParams.get('user_scope'), 'chat:write')
      assert.equal(authorization.searchParams.get('scope'), '')
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
      assert.match(authorization.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/)
      assert.equal(authorization.searchParams.get('redirect_uri'), SLACK_REDIRECT_URI)
      assert.equal(authorization.searchParams.get('client_secret'), null)
      await completeCallback(authorization)
    },
    fetcher: async (_url, init) => { tokenBody = String(init?.body); return slackUserPayload() },
    now: () => NOW,
  })
  assert.deepEqual(SLACK_USER_SCOPES, ['chat:write'])
  assert.equal(tokens.accessToken, 'xoxe.xoxp-1-access')
  assert.equal(tokens.refreshToken, 'xoxe-1-refresh')
  assert.equal(tokens.expiresAt, NOW + 43_200_000)
  assert.equal(tokens.refreshExpiresAt, NOW + THIRTY_DAYS_MS)
  assert.equal(tokens.teamId, 'T0C19BLLJBX')
  assert.equal(tokens.userId, 'U00000001')
  assert.match(tokenBody, /code_verifier=/)
  assert.doesNotMatch(tokenBody, /client_secret=/)
})

test('rejects a callback whose state does not match', async () => {
  await assert.rejects(authorizeSlack(CLIENT_ID, {
    openExternal: async (url) => {
      const callback = new URL(new URL(url).searchParams.get('redirect_uri') || '')
      callback.searchParams.set('code', 'slack-code')
      callback.searchParams.set('state', 'wrong')
      await fetch(callback)
    },
    timeoutMs: 500,
  }), /state did not match/)
})

test('requires a configured client ID', async () => {
  await assert.rejects(authorizeSlack('', { openExternal: async () => undefined }), /not configured/)
})

test('parses top-level rotating user tokens as a fallback', () => {
  const tokens = parseSlackTokens({
    ok: true,
    access_token: 'xoxe.xoxp-1-a',
    refresh_token: 'xoxe-1-b',
    expires_in: 43_200,
    scope: 'chat:write',
    team: { id: 'T1' },
    authed_user: { id: 'U1' },
  }, NOW)
  assert.equal(tokens.accessToken, 'xoxe.xoxp-1-a')
  assert.equal(tokens.refreshToken, 'xoxe-1-b')
  assert.equal(tokens.teamId, 'T1')
  assert.equal(tokens.userId, 'U1')
})

test('requires a refresh token and explains token rotation', () => {
  assert.throws(() => parseSlackTokens({ ok: true, access_token: 'xoxp-a', expires_in: 43_200, authed_user: { id: 'U1' } }, NOW), /Token Rotation/)
})

test('refreshes with client_id only and reports expired refresh tokens', async () => {
  const bodies: string[] = []
  const refreshed = await refreshSlackTokens(CLIENT_ID, 'xoxe-1-old', {
    fetcher: async (_url, init) => { bodies.push(String(init?.body)); return slackUserPayload({ refresh_token: 'xoxe-1-new' }) },
    now: () => NOW,
  })
  assert.match(bodies[0] || '', /grant_type=refresh_token/)
  assert.match(bodies[0] || '', /client_id=/)
  assert.doesNotMatch(bodies[0] || '', /client_secret/)
  assert.equal(refreshed.refreshToken, 'xoxe-1-new')
  await assert.rejects(refreshSlackTokens(CLIENT_ID, 'xoxe-1-old', {
    fetcher: async () => Response.json({ ok: false, error: 'invalid_refresh_token' }),
  }), (error: unknown) => error instanceof SlackReconnectError)
})

test('maps Slack errors and invalid responses to safe messages', async () => {
  const failing = (fetcher: typeof fetch) => refreshSlackTokens(CLIENT_ID, 'xoxe-1-old', { fetcher })
  await assert.rejects(failing(async () => Response.json({ ok: false, error: 'invalid_code' })), /invalid_code/)
  await assert.rejects(failing(async () => new Response('not json', { status: 200 })), /Slack rejected/)
  await assert.rejects(failing(async () => new Response('{}', { status: 500 })), /Slack rejected/)
  await assert.rejects(failing(async () => { throw new Error('offline') }), /could not be reached/)
})

async function completeCallback(authorization: URL): Promise<void> {
  const callback = new URL(authorization.searchParams.get('redirect_uri') || '')
  callback.searchParams.set('code', 'slack-code')
  callback.searchParams.set('state', authorization.searchParams.get('state') || '')
  const response = await fetch(callback)
  assert.equal(response.status, 200)
}

function slackUserPayload(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    ok: true,
    app_id: 'A0C1C2FVC78',
    team: { id: 'T0C19BLLJBX', name: 'gappd' },
    authed_user: {
      id: 'U00000001',
      scope: 'chat:write',
      access_token: 'xoxe.xoxp-1-access',
      expires_in: 43_200,
      refresh_token: 'xoxe-1-refresh',
      token_type: 'user',
      ...overrides,
    },
  })
}
