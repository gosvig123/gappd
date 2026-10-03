import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeSlack, completeSlackAuthorization, parseSlackTokens, refreshSlackTokens, SlackReconnectError, SLACK_REDIRECT_URI, SLACK_USER_SCOPES } from './slack-oauth.ts'

const CLIENT_ID = '1234567890.1234567890'
const NOW = 1_788_000_000_000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

test('runs the desktop PKCE flow without a fixed workspace or client secret', async () => {
  let tokenBody = ''
  const tokens = await authorizeSlack(CLIENT_ID, {
    openExternal: async (url) => {
      const authorization = new URL(url)
      assert.equal(authorization.origin + authorization.pathname, 'https://slack.com/oauth/v2/authorize')
      assert.equal(authorization.searchParams.get('client_id'), CLIENT_ID)
      assert.equal(authorization.searchParams.get('user_scope'), SLACK_USER_SCOPES.join(','))
      assert.equal(authorization.searchParams.get('scope'), '')
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
      assert.match(authorization.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/)
      assert.equal(authorization.searchParams.get('redirect_uri'), 'gappd://slack/oauth/callback')
      assert.equal(authorization.searchParams.has('team'), false)
      assert.equal(authorization.searchParams.get('client_secret'), null)
      await completeCallback(authorization)
    },
    fetcher: async (_url, init) => { tokenBody = String(init?.body); return slackUserPayload() },
    now: () => NOW,
  })
  assert.deepEqual(SLACK_USER_SCOPES, ['chat:write', 'channels:read', 'groups:read', 'im:read', 'mpim:read', 'users:read', 'users:read.email', 'channels:history', 'groups:history', 'im:history'])
  assert.equal(tokens.accessToken, 'xoxe.xoxp-1-access')
  assert.equal(tokens.refreshToken, 'xoxe-1-refresh')
  assert.equal(tokens.expiresAt, NOW + 43_200_000)
  assert.equal(tokens.refreshExpiresAt, NOW + THIRTY_DAYS_MS)
  assert.equal(tokens.teamId, 'T0C19BLLJBX')
  assert.equal(tokens.teamName, 'gappd')
  assert.equal(tokens.userId, 'U00000001')
  assert.match(tokenBody, /code_verifier=/)
  assert.equal(new URLSearchParams(tokenBody).get('redirect_uri'), SLACK_REDIRECT_URI)
  assert.doesNotMatch(tokenBody, /client_secret=/)
})

test('ignores unsolicited, wrong-state and wrong-target callbacks without cancelling the real flow', async () => {
  assert.equal(completeSlackAuthorization(`${SLACK_REDIRECT_URI}?code=unsolicited`), false)
  await authorizeSlack(CLIENT_ID, {
    openExternal: async (input) => {
      const authorization = new URL(input)
      const callback = callbackUrl(authorization)
      for (const invalid of ['not a URL', callback.href.replace('gappd:', 'https:'), callback.href.replace('/oauth/callback', '/other'), callback.href.replace('//slack', '//attacker@slack'), `${callback.href}#fragment`]) {
        assert.equal(completeSlackAuthorization(invalid), false)
      }
      callback.searchParams.set('state', 'wrong')
      assert.equal(completeSlackAuthorization(callback.href), false)
      completeCallback(authorization)
    },
    fetcher: async () => slackUserPayload(),
  })
})

test('rejects duplicate parameters, denied consent and invalid codes before token exchange', async () => {
  for (const suffix of ['&state=duplicate', '&code=duplicate', '&error=access_denied', '&error=a&error=b']) {
    await assert.rejects(authorizeSlack(CLIENT_ID, {
      openExternal: async (input) => { assert.equal(completeSlackAuthorization(callbackUrl(new URL(input)).href + suffix), true) },
      fetcher: async () => { assert.fail('invalid callback must not exchange a code') },
    }), /callback|not completed/)
  }
  for (const code of ['', 'bad code', 'x'.repeat(4097)]) {
    await assert.rejects(authorizeSlack(CLIENT_ID, {
      openExternal: async (input) => {
        const callback = callbackUrl(new URL(input))
        callback.searchParams.set('code', code)
        assert.equal(completeSlackAuthorization(callback.href), true)
      },
      fetcher: async () => { assert.fail('invalid code must not be exchanged') },
    }), /missing or invalid/)
  }
})

test('timeout and browser failures release pending authorization and reject late callbacks', async () => {
  let lateCallback = ''
  await assert.rejects(authorizeSlack(CLIENT_ID, {
    openExternal: async (input) => { lateCallback = callbackUrl(new URL(input)).href }, timeoutMs: 1,
  }), /timed out/)
  assert.equal(completeSlackAuthorization(lateCallback), false)
  await assert.rejects(authorizeSlack(CLIENT_ID, {
    openExternal: async (input) => { lateCallback = callbackUrl(new URL(input)).href; throw new Error('browser unavailable') },
  }), /browser unavailable/)
  assert.equal(completeSlackAuthorization(lateCallback), false)
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

function completeCallback(authorization: URL): void {
  const callback = callbackUrl(authorization)
  assert.equal(completeSlackAuthorization(callback.href), true)
  assert.equal(completeSlackAuthorization(callback.href), false, 'a callback can be consumed only once')
}

function callbackUrl(authorization: URL): URL {
  const callback = new URL(authorization.searchParams.get('redirect_uri') || '')
  callback.searchParams.set('code', 'slack-code')
  callback.searchParams.set('state', authorization.searchParams.get('state') || '')
  return callback
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
