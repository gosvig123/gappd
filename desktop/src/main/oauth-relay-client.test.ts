import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { OAuthRelayClient, type RelayInstallation, type RelayInstallationStore } from './oauth-relay-client.ts'

const BASE_URL = 'https://auth.getgappd.com'
const INSTALLATION_ID = '123e4567-e89b-12d3-a456-426614174000'
const NOW = 1_788_095_800_000

test('enrolls once and signs token requests', async () => {
  const persisted: { value: RelayInstallation | null } = { value: null }
  let enrollments = 0
  const requests: Array<{ headers: Headers; body: string }> = []
  const store: RelayInstallationStore = {
    read: async () => persisted.value,
    write: async (value) => { persisted.value = value },
  }
  const client = new OAuthRelayClient({ baseUrl: BASE_URL, store, now: () => NOW,
    fetcher: relayFetcher(() => { enrollments += 1 }, requests) })
  const first = await client.requestTokens(authorizationGrant())
  const second = await client.requestTokens({ grantType: 'refresh_token', refreshToken: 'refresh' })
  assert.equal(enrollments, 1)
  assert.equal(requests.length, 2)
  assert.equal(first.accessToken, 'access')
  assert.equal(second.refreshToken, 'refresh')
  const stored = persisted.value
  assert.ok(stored)
  assert.ok(stored.privateKeyPem.includes('PRIVATE KEY'))
  assert.equal(stored.dpopNonce, 'next-nonce')
  assertSignedRequest(requests[0], stored)
  assertDpopProof(requests[0], false)
  assertDpopProof(requests[1], true)
})

test('retries a Google DPoP code challenge once with its nonce', async () => {
  const proofs: string[] = []
  const store = memoryStore(createFixtureInstallation())
  const client = new OAuthRelayClient({ baseUrl: BASE_URL, store, now: () => NOW,
    fetcher: async (_input, init) => {
      proofs.push(new Headers(init?.headers).get('dpop') || '')
      if (proofs.length === 1) return Response.json({ error: 'use_dpop_nonce' }, { status: 400, headers: { 'DPoP-Nonce': 'challenge-nonce' } })
      return Response.json({ access_token: 'access' })
    } })
  assert.equal((await client.requestTokens(authorizationGrant())).accessToken, 'access')
  assert.equal(proofs.length, 2)
  assert.equal('nonce' in dpopPayload(proofs[0]), false)
  assert.equal(dpopPayload(proofs[0]).jti, digest('code'))
  assert.equal(dpopPayload(proofs[1]).nonce, 'challenge-nonce')
  assert.equal(dpopPayload(proofs[0]).jti, dpopPayload(proofs[1]).jti)
})

test('returns only a safe relay error', async () => {
  const store = memoryStore(createFixtureInstallation())
  const client = new OAuthRelayClient({ baseUrl: BASE_URL, store, now: () => NOW,
    fetcher: async () => Response.json({ error: 'rate_limited', error_description: 'private detail' }, { status: 429 }) })
  await assert.rejects(client.requestTokens(authorizationGrant()), /^Error: OAuth relay request failed \(429: rate_limited\)\.$/)
})

test('accepts HTTPS and local relay origins only', () => {
  const store = memoryStore(null)
  assert.doesNotThrow(() => new OAuthRelayClient({ baseUrl: 'http://127.0.0.1:3001', store }))
  assert.throws(() => new OAuthRelayClient({ baseUrl: 'http://auth.getgappd.com', store }), /URL is invalid/)
  assert.throws(() => new OAuthRelayClient({ baseUrl: 'https://auth.getgappd.com/path', store }), /URL is invalid/)
})

function relayFetcher(onEnrollment: () => void, requests: Array<{ headers: Headers; body: string }>): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/v1/installations') {
      onEnrollment()
      return Response.json({ installationId: INSTALLATION_ID }, { status: 201 })
    }
    requests.push({ headers: new Headers(init?.headers), body: String(init?.body) })
    const request = JSON.parse(String(init?.body))
    return Response.json({ access_token: 'access', refresh_token: request.refreshToken, expires_in: 60, token_type: 'Bearer' },
      { headers: { 'DPoP-Nonce': 'next-nonce' } })
  }
}

function assertSignedRequest(request: { headers: Headers; body: string }, installation: RelayInstallation): void {
  const timestamp = request.headers.get('x-gappd-timestamp')!
  const nonce = request.headers.get('x-gappd-nonce')!
  const dpop = request.headers.get('dpop')!
  const message = ['POST', '/v1/google/token', timestamp, nonce, digest(request.body), digest(dpop)].join('\n')
  const signature = Buffer.from(request.headers.get('x-gappd-signature')!, 'base64url')
  const key = createPublicKey({ key: installation.publicKey, format: 'jwk' })
  assert.equal(verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, signature), true)
}

function assertDpopProof(request: { headers: Headers }, expectNonce: boolean): void {
  const proof = request.headers.get('dpop')!
  const [encodedHeader, encodedPayload, encodedSignature] = proof.split('.')
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
  const payload = dpopPayload(proof)
  const key = createPublicKey({ key: header.jwk, format: 'jwk' })
  const valid = verify('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(encodedSignature, 'base64url'))
  assert.equal(valid, true)
  assert.equal(payload.htm, 'POST')
  assert.equal(payload.htu, 'https://oauth2.googleapis.com/token')
  assert.equal(payload.iat, Math.floor(NOW / 1000))
  assert.equal('nonce' in payload, expectNonce)
}

function dpopPayload(proof: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(proof.split('.')[1], 'base64url').toString()) as Record<string, unknown>
}

function memoryStore(initial: RelayInstallation | null): RelayInstallationStore {
  let value = initial
  return { read: async () => value, write: async (next) => { value = next } }
}

function createFixtureInstallation(): RelayInstallation {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    id: INSTALLATION_ID,
    privateKeyPem: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: keys.publicKey.export({ format: 'jwk' }),
  }
}

function authorizationGrant() {
  return { grantType: 'authorization_code' as const, code: 'code', codeVerifier: 'a'.repeat(43), redirectUri: 'http://127.0.0.1:45678' }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}
