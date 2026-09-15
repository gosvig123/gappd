import type { CloudAuthStatus } from '../shared/cloud-auth-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeOAuth, parseTokenResponse, type OAuthTokenRequest, type OAuthTokenSet } from './oauth.ts'

export type CloudAuthConfig = { issuer: string; clientId: string; resource?: string }
export type CloudCredential = { version: 1; issuer: string; clientId: string; resource?: string; subject: string; email: string; tokens: OAuthTokenSet }
type Store = { read(): Promise<CloudCredential | null>; write(value: CloudCredential): Promise<void>; clear(): Promise<void> }
type Dependencies = { openExternal(url: string): Promise<unknown>; requireSecureStorage(): void; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number }
const LOGIN_ERROR = 'Cloud sign-in failed or was cancelled. Unlock this Mac, check your connection, and reconnect explicitly to retry.'

export class CloudAuth {
  private listeners = new Set<() => void>()
  private generation = 0
  private authorizationVersion = 0
  private pending: AbortController | null = null
  private mutations: Promise<unknown> = Promise.resolve()
  private error: string | null = null
  private forcedOff = false
  private config: CloudAuthConfig
  private store: Store
  private dependencies: Dependencies

  constructor(config: CloudAuthConfig, store: Store, dependencies: Dependencies) {
    this.config = config; this.store = store; this.dependencies = dependencies
  }

  async status(): Promise<CloudAuthStatus> {
    if (this.forcedOff) return this.snapshot(null, this.error)
    try {
      const value = await this.serialize(() => this.store.read())
      if (value && !validCredential(value, this.config, this.now())) return this.snapshot(null, 'Cloud sign-in expired or is invalid. Reconnect explicitly.')
      return this.snapshot(value, this.error)
    } catch { return this.snapshot(null, 'Secure cloud credentials are unavailable. Unlock this Mac or choose Remove local credentials.') }
  }

  async setEnabled(enabled: unknown): Promise<CloudAuthStatus> {
    if (typeof enabled !== 'boolean') throw new Error('Cloud sync requires a boolean.')
    if (enabled && this.pending) return this.status()
    this.forcedOff = true
    const generation = ++this.generation
    this.invalidateAuthorization()
    this.pending?.abort(); this.pending = null; this.error = null
    if (!enabled) {
      try { await this.serialize(() => this.store.clear()) }
      catch { this.error = 'Cloud credentials could not be removed. Choose Remove local credentials to retry before restarting.' }
      return this.snapshot(null, this.error)
    }
    const controller = new AbortController()
    this.pending = controller
    try { await this.connect(generation, controller.signal); if (generation === this.generation) this.forcedOff = false }
    catch { if (generation === this.generation) this.error = LOGIN_ERROR }
    finally { if (generation === this.generation) this.pending = null }
    return this.status()
  }

  private async connect(generation: number, signal: AbortSignal): Promise<void> {
    this.dependencies.requireSecureStorage()
    await this.serialize(() => this.store.clear())
    signal.throwIfAborted()
    const fetcher: typeof fetch = (url, init) => (this.dependencies.fetcher || fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
    const tokens = await authorizeOAuth({ clientId: this.config.clientId, authorizeUrl: `${this.config.issuer}/oauth/authorize`, tokenUrl: `${this.config.issuer}/oauth/token`, scopes: this.config.resource ? ['email', 'profile', 'meetings:sync'] : ['email', 'profile'], callbackPath: '/callback', issuer: this.config.issuer, authorizeParams: { prompt: 'consent', ...(this.config.resource ? { resource: this.config.resource } : {}) } }, { ...this.dependencies, fetcher, signal, tokenRequester: request => requestCloudTokens(this.config, request, fetcher, this.now()) })
    if (!validTokens(tokens, this.now())) throw new Error('Invalid cloud token.')
    signal.throwIfAborted()
    const response = await fetcher(`${this.config.issuer}/oauth/userinfo`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
    if (!response.ok) throw new Error('Cloud account verification failed.')
    const user = await response.json()
    if (!user || !safeText(user.sub) || !safeText(user.email) || user.email_verified !== true) throw new Error('Verified cloud account required.')
    const value: CloudCredential = { version: 1, ...this.config, subject: user.sub, email: user.email, tokens }
    await this.serialize(async () => { if (generation === this.generation && !signal.aborted) await this.store.write(value) })
  }

  invalidateAuthorization(): number {
    this.authorizationVersion++
    for (const listener of this.listeners) listener()
    return this.authorizationVersion
  }

  authorizationGeneration(): number { return this.authorizationVersion }

  observeAuthorization(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async credential(): Promise<CloudCredential | null> {
    const generation = this.generation
    if (this.forcedOff || this.pending) return null
    const value = await this.serialize(() => this.store.read())
    return generation === this.generation && !this.forcedOff && value && validCredential(value, this.config, this.now()) ? value : null
  }

  private snapshot(value: CloudCredential | null, error: string | null): CloudAuthStatus {
    return { enabled: Boolean(value), pending: Boolean(this.pending), email: value?.email ?? null, subject: value?.subject ?? null, error }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation)
    this.mutations = result.catch(() => undefined)
    return result
  }

  private now(): number { return (this.dependencies.now || Date.now)() }
}

function safeText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 320 && !/[\x00-\x1f\x7f]/.test(value)
}

function validTokens(value: OAuthTokenSet, now: number): boolean {
  return Boolean(value && typeof value.accessToken === 'string' && value.accessToken.length > 0 && value.accessToken.length <= 16384 && !/\s/.test(value.accessToken) && typeof value.tokenType === 'string' && value.tokenType.toLowerCase() === 'bearer' && Number.isFinite(value.expiresAt) && value.expiresAt > now + 60_000)
}

function validCredential(value: CloudCredential, config: CloudAuthConfig, now: number): boolean {
  return value.version === 1 && value.issuer === config.issuer && value.clientId === config.clientId && value.resource === config.resource && safeText(value.subject) && safeText(value.email) && validTokens(value.tokens, now)
}

async function requestCloudTokens(config: CloudAuthConfig, request: OAuthTokenRequest, fetcher: typeof fetch, now: number): Promise<OAuthTokenSet> {
  if (request.grantType !== 'authorization_code') throw new Error('Explicit sign-in required.')
  const body = new URLSearchParams({ grant_type: request.grantType, client_id: config.clientId, code: request.code, redirect_uri: request.redirectUri, code_verifier: request.codeVerifier })
  const response = await fetcher(`${config.issuer}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error('Cloud token exchange failed.')
  const value = await response.json()
  if (!value || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 60 || typeof value.token_type !== 'string') throw new Error('Invalid cloud token response.')
  const tokens = parseTokenResponse(value, now)
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, tokenType: tokens.tokenType }
}
