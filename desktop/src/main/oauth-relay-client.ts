import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, type JsonWebKey as CryptoJsonWebKey } from 'node:crypto'
import type { OAuthTokenRequest, OAuthTokenSet } from './oauth'

const INSTALLATIONS_PATH = '/v1/installations'
const TOKEN_PATH = '/v1/google/token'
const REQUEST_TIMEOUT_MS = 10_000
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SAFE_ERROR = /^[a-z_]{1,60}$/

export type RelayInstallation = {
  id: string
  privateKeyPem: string
  publicKey: CryptoJsonWebKey
  dpopNonce?: string
}

export type RelayInstallationStore = {
  read(): Promise<RelayInstallation | null>
  write(value: RelayInstallation): Promise<void>
}

export type OAuthRelayOptions = {
  baseUrl: string
  store: RelayInstallationStore
  fetcher?: typeof fetch
  now?: () => number
}

export class OAuthRelayClient {
  private readonly baseUrl: string
  private readonly store: RelayInstallationStore
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private installationPromise: Promise<RelayInstallation> | null = null

  constructor(options: OAuthRelayOptions) {
    this.baseUrl = relayOrigin(options.baseUrl)
    this.store = options.store
    this.fetcher = options.fetcher || fetch
    this.now = options.now || Date.now
  }

  async requestTokens(request: OAuthTokenRequest): Promise<OAuthTokenSet> {
    return this.sendTokenRequest(request, await this.installation(), false)
  }

  private async sendTokenRequest(request: OAuthTokenRequest, installation: RelayInstallation, retried: boolean): Promise<OAuthTokenSet> {
    const dpop = createDpopProof(installation, installation.dpopNonce, this.now())
    const body = JSON.stringify(request)
    const response = await this.fetch(TOKEN_PATH, { method: 'POST', headers: signedHeaders(installation, body, dpop, this.now()), body })
    const nextNonce = validDpopNonce(response.headers.get('dpop-nonce'))
    if (nextNonce) {
      installation.dpopNonce = nextNonce
      await this.store.write(installation)
    }
    if (!response.ok && !retried && await isDpopChallenge(response, nextNonce)) return this.sendTokenRequest(request, installation, true)
    if (!response.ok) throw await relayError(response)
    return parseRelayTokenResponse(await response.json() as Record<string, unknown>, this.now())
  }

  private installation(): Promise<RelayInstallation> {
    if (!this.installationPromise) {
      this.installationPromise = this.loadOrEnroll().catch((error) => {
        this.installationPromise = null
        throw error
      })
    }
    return this.installationPromise
  }

  private async loadOrEnroll(): Promise<RelayInstallation> {
    const stored = await this.store.read()
    if (stored) return stored
    const installation = createInstallation()
    const enrollment = enrollmentBody(installation)
    const response = await this.fetch(INSTALLATIONS_PATH, jsonRequest(enrollment))
    if (!response.ok) throw await relayError(response)
    const value = await response.json() as Record<string, unknown>
    installation.id = installationId(value.installationId)
    await this.store.write(installation)
    return installation
  }

  private fetch(path: string, init: RequestInit): Promise<Response> {
    return this.fetcher(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  }
}

function createInstallation(): RelayInstallation {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const publicKey = keys.publicKey.export({ format: 'jwk' })
  return { id: '', privateKeyPem, publicKey }
}

function enrollmentBody(installation: RelayInstallation): Record<string, unknown> {
  const nonce = randomBytes(24).toString('base64url')
  const message = `gappd-installation-enrollment\n${nonce}\n${keyThumbprint(installation.publicKey)}`
  return { publicKey: installation.publicKey, nonce, signature: signature(installation, message) }
}

function signedHeaders(installation: RelayInstallation, body: string, dpop: string, timestamp: number): Record<string, string> {
  const time = String(timestamp)
  const nonce = randomBytes(24).toString('base64url')
  const message = ['POST', TOKEN_PATH, time, nonce, digest(body), digest(dpop)].join('\n')
  return {
    'content-type': 'application/json', DPoP: dpop,
    'x-gappd-installation': installation.id,
    'x-gappd-timestamp': time,
    'x-gappd-nonce': nonce,
    'x-gappd-signature': signature(installation, message),
  }
}

function signature(installation: RelayInstallation, message: string): string {
  const key = createPrivateKey(installation.privateKeyPem)
  return sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
}

function keyThumbprint(jwk: CryptoJsonWebKey): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  return digest(canonical)
}

function createDpopProof(installation: RelayInstallation, nonce: string | undefined, now: number): string {
  const jwk = installation.publicKey
  const header = encodeJson({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } })
  const payload: Record<string, unknown> = {
    htm: 'POST', htu: GOOGLE_TOKEN_URL, iat: Math.floor(now / 1000), jti: randomBytes(24).toString('base64url'),
  }
  if (nonce) payload.nonce = nonce
  const message = `${header}.${encodeJson(payload)}`
  return `${message}.${signature(installation, message)}`
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function isDpopChallenge(response: Response, nonce: string | null): Promise<boolean> {
  if (response.status !== 400 || !nonce) return false
  const value = await response.clone().json().catch(() => null) as Record<string, unknown> | null
  return value?.error === 'use_dpop_nonce'
}

function validDpopNonce(value: string | null): string | null {
  return value && /^[\x21-\x7e]{1,512}$/.test(value) ? value : null
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function relayOrigin(value: string): string {
  const url = new URL(value)
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1'
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('OAuth relay URL is invalid.')
  }
  return url.origin
}

function jsonRequest(value: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

function parseRelayTokenResponse(value: Record<string, unknown>, now: number): OAuthTokenSet {
  if (typeof value.access_token !== 'string') throw new Error('OAuth relay returned an invalid token response.')
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : 3600
  return {
    accessToken: value.access_token,
    refreshToken: optionalString(value.refresh_token),
    expiresAt: now + expiresIn * 1000,
    tokenType: optionalString(value.token_type) || 'Bearer',
    scope: optionalString(value.scope),
  }
}

function installationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) throw new Error('OAuth relay returned an invalid installation.')
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

async function relayError(response: Response): Promise<Error> {
  const value = await response.clone().json().catch(() => null) as Record<string, unknown> | null
  const code = value && typeof value.error === 'string' && SAFE_ERROR.test(value.error) ? value.error : 'request_failed'
  return new Error(`OAuth relay request failed (${response.status}: ${code}).`)
}
