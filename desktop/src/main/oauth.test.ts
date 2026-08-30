import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeOAuth, buildAuthorizationUrl, createPkce, parseTokenResponse, type OAuthConfig } from './oauth.ts'

const CONFIG: OAuthConfig = {
  clientId: 'public-client',
  authorizeUrl: 'https://issuer.example/oauth/authorize',
  tokenUrl: 'https://issuer.example/oauth/token',
  scopes: ['openid', 'email'],
  callbackPath: '/callback',
}

test('PKCE uses base64url values and an S256 challenge', () => {
  const value = createPkce()
  assert.match(value.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.match(value.challenge, /^[A-Za-z0-9_-]{43}$/)
  assert.match(value.state, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(value.verifier, value.state)
})

test('authorization URL contains public-client PKCE fields', () => {
  const url = new URL(buildAuthorizationUrl(CONFIG, 'http://127.0.0.1:123/callback', 'challenge', 'state'))
  assert.equal(url.searchParams.get('client_id'), CONFIG.clientId)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:123/callback')
  assert.equal(url.searchParams.get('scope'), 'openid email')
})

test('loopback redirect can omit the trailing slash required by Google', async () => {
  const config: OAuthConfig = { ...CONFIG, callbackPath: '' }
  await authorizeOAuth(config, {
    openExternal: async (url) => {
      const redirectUri = new URL(url).searchParams.get('redirect_uri')!
      assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/)
      await completeBrowserAuthorization(url)
    },
    fetcher: async () => Response.json({ access_token: 'access', expires_in: 60 }),
  })
})

test('loopback authorization validates state and exchanges code without a secret', async () => {
  let tokenBody = ''
  const tokens = await authorizeOAuth(CONFIG, {
    openExternal: completeBrowserAuthorization,
    fetcher: async (_url, init) => {
      tokenBody = String(init?.body)
      return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 60 })
    },
    now: () => 1_000,
  })
  assert.equal(tokens.expiresAt, 61_000)
  assert.match(tokenBody, /code_verifier=/)
  assert.doesNotMatch(tokenBody, /client_secret=/)
})

test('loopback authorization rejects mismatched state', async () => {
  await assert.rejects(authorizeOAuth(CONFIG, {
    openExternal: async (url) => {
      const authorization = new URL(url)
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      callback.searchParams.set('code', 'code')
      callback.searchParams.set('state', 'wrong')
      await fetch(callback)
    },
    timeoutMs: 500,
  }), /state did not match/)
})

test('token parser rejects missing access tokens', () => {
  assert.throws(() => parseTokenResponse({ expires_in: 60 }, 0), /invalid token response/)
})

async function completeBrowserAuthorization(url: string): Promise<void> {
  const authorization = new URL(url)
  const callback = new URL(authorization.searchParams.get('redirect_uri')!)
  callback.searchParams.set('code', 'authorization-code')
  callback.searchParams.set('state', authorization.searchParams.get('state')!)
  const response = await fetch(callback)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
}
