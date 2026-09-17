import { randomUUID } from 'node:crypto'
import type { CloudAuthStatus } from '../shared/cloud-auth-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeOAuth, parseTokenResponse, refreshOAuthToken, type OAuthTokenRequest, type OAuthTokenSet } from './oauth.ts'

export type CloudAuthConfig = { issuer: string; clientId: string; resource?: string; refreshTokens?: boolean }
export type CloudCredential = { version: 1; issuer: string; clientId: string; resource?: string; subject: string; email: string; tokens: OAuthTokenSet; authorizationId?: string; uploadConsent?: boolean; verificationPending?: boolean }
type Store = { read(): Promise<CloudCredential | null>; write(value: CloudCredential): Promise<void>; clear(): Promise<void> }
type Dependencies = { openExternal(url: string): Promise<unknown>; requireSecureStorage(): void; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number }
const LOGIN_ERROR = 'Cloud sign-in failed or was cancelled. Unlock this Mac, check your connection, and reconnect explicitly to retry.'
const RECONNECT_ERROR = 'Cloud authorization expired or was revoked. Reconnect the upload account.'
class ReconnectRequired extends Error {}

export class CloudAuth {
  private listeners = new Set<() => void>()
  private generation = 0
  private authorizationVersion = 0
  private pending: AbortController | null = null
  private refreshing: AbortController | null = null
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
      if (value && (!boundCredential(value, this.config) || (!validTokens(value.tokens, this.now()) && !this.canRefresh(value)))) return this.snapshot(null, RECONNECT_ERROR)
      const error = this.error || (value?.uploadConsent && this.config.refreshTokens && !this.canRefresh(value)
        ? 'Reconnect this older upload connection once to enable automatic token refresh.' : null)
      return this.snapshot(value, error)
    } catch { return this.snapshot(null, 'Secure cloud credentials are unavailable. Unlock this Mac or choose Remove local credentials.') }
  }

  async setEnabled(enabled: unknown): Promise<CloudAuthStatus> {
    if (typeof enabled !== 'boolean') throw new Error('Cloud sync requires a boolean.')
    if (enabled && this.pending) return this.status()
    this.forcedOff = true
    const generation = ++this.generation
    this.invalidateAuthorization()
    this.pending?.abort(); this.pending = null; this.refreshing?.abort(); this.error = null
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
    const tokens = await authorizeOAuth({ clientId: this.config.clientId, authorizeUrl: `${this.config.issuer}/oauth/authorize`, tokenUrl: `${this.config.issuer}/oauth/token`, scopes: [...(this.config.resource ? ['email', 'profile', 'meetings:sync'] : ['email', 'profile']), ...(this.config.refreshTokens ? ['offline_access'] : [])], callbackPath: '/callback', issuer: this.config.issuer, authorizeParams: { prompt: 'consent', ...(this.config.resource ? { resource: this.config.resource } : {}) } }, { ...this.dependencies, fetcher, signal, tokenRequester: request => requestCloudTokens(this.config, request, fetcher, this.now()) })
    if (!validTokens(tokens, this.now()) || (this.config.refreshTokens && !tokens.refreshToken)) throw new Error('Invalid cloud token or missing offline access.')
    signal.throwIfAborted()
    const response = await fetcher(`${this.config.issuer}/oauth/userinfo`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
    if (!response.ok) throw new Error('Cloud account verification failed.')
    const user = await response.json()
    if (!user || !safeText(user.sub) || !safeText(user.email) || user.email_verified !== true) throw new Error('Verified cloud account required.')
    const value: CloudCredential = { version: 1, issuer: this.config.issuer, clientId: this.config.clientId, resource: this.config.resource,
      subject: user.sub, email: user.email, tokens, authorizationId: randomUUID() }
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

  /** Restores only explicit upload intent. This never refreshes tokens or opens a browser. */
  async savedUploadCredential(): Promise<CloudCredential | null> {
    const generation = this.generation
    return this.serialize(async () => {
      const value = await this.store.read()
      return generation === this.generation && !this.forcedOff && value?.uploadConsent === true && boundCredential(value, this.config) ? value : null
    })
  }

  /** Consent shares the encrypted credential record, so disconnect removes both atomically. */
  async setUploadConsent(expected: CloudCredential | null): Promise<CloudCredential | null> {
    const generation = this.generation
    return this.serialize(async () => {
      const value = await this.store.read()
      if (expected && (generation !== this.generation || this.forcedOff || !value || !boundCredential(value, this.config) ||
        !validTokens(value.tokens, this.now()) || value.verificationPending || value.subject !== expected.subject || value.tokens.accessToken !== expected.tokens.accessToken ||
        value.authorizationId !== expected.authorizationId)) throw new Error('Upload account changed. Check the account before enabling sync.')
      if (!value) return null
      this.dependencies.requireSecureStorage()
      const next = { ...value, authorizationId: value.authorizationId || randomUUID(), uploadConsent: Boolean(expected) }
      try { await this.store.write(next) }
      catch { throw new Error('Upload consent could not be saved. Sync is paused in this session. Choose OFF to remove local credentials before restarting.') }
      return expected && generation === this.generation && !this.forcedOff ? next : null
    })
  }

  async credential(): Promise<CloudCredential | null> {
    const generation = this.generation
    if (this.forcedOff || this.pending) return null
    // Serialize the entire refresh: rotating a refresh token twice can revoke the connection.
    return this.serialize(async () => {
      const value = await this.store.read()
      if (generation !== this.generation || this.forcedOff || !value || !boundCredential(value, this.config)) return null
      if (validTokens(value.tokens, this.now()) && !value.verificationPending) return value
      if (!this.canRefresh(value) && !value.verificationPending) { this.error = RECONNECT_ERROR; return null }
      return this.refresh(value, generation)
    })
  }

  private canRefresh(value: CloudCredential): boolean {
    return Boolean(this.config.refreshTokens && value.tokens.refreshToken && value.authorizationId)
  }

  private async refresh(value: CloudCredential, generation: number): Promise<CloudCredential | null> {
    const controller = new AbortController()
    this.refreshing = controller
    const fetcher: typeof fetch = (url, init) => (this.dependencies.fetcher || fetch)(url, {
      ...init, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    })
    try {
      this.dependencies.requireSecureStorage()
      let next = value
      if (!validTokens(value.tokens, this.now())) {
        const tokens = await refreshOAuthToken({ clientId: this.config.clientId, authorizeUrl: `${this.config.issuer}/oauth/authorize`,
          tokenUrl: `${this.config.issuer}/oauth/token`, scopes: [], callbackPath: '/callback' }, value.tokens, fetcher, () => this.now(),
          request => requestCloudTokens(this.config, request, fetcher, this.now()))
        controller.signal.throwIfAborted()
        if (generation !== this.generation || this.forcedOff) return null
        // Keep rotated tokens if userinfo is temporarily offline, but do not use them until verified.
        next = { ...value, tokens, verificationPending: true }
        await this.store.write(next)
      }
      controller.signal.throwIfAborted()
      const response = await fetcher(`${this.config.issuer}/oauth/userinfo`, { headers: { Authorization: `Bearer ${next.tokens.accessToken}` } })
      if (response.status === 401 || response.status === 403) throw new ReconnectRequired()
      if (!response.ok) throw new Error('Cloud account verification unavailable.')
      const user = await response.json()
      if (user?.sub !== value.subject || !safeText(user.email) || user.email_verified !== true) throw new ReconnectRequired()
      if (generation !== this.generation || controller.signal.aborted || this.forcedOff) return null
      next = { ...next, email: user.email, verificationPending: false }
      await this.store.write(next)
      if (generation !== this.generation || this.forcedOff) return null
      this.error = null
      return next
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return null
      if (error instanceof ReconnectRequired) {
        this.forcedOff = true
        this.invalidateAuthorization()
        this.error = RECONNECT_ERROR
        try { await this.store.clear() }
        catch { this.error = 'Revoked cloud credentials could not be removed. Choose OFF to retry before restarting.' }
      } else this.error = 'Cloud token refresh failed. Unlock this Mac and check your connection; sync will retry automatically.'
      return null
    } finally {
      if (this.refreshing === controller) this.refreshing = null
    }
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
  return tokenShape(value) && value.expiresAt > now + 60_000
}

function tokenShape(value: OAuthTokenSet): boolean {
  return Boolean(value && typeof value.accessToken === 'string' && value.accessToken.length > 0 && value.accessToken.length <= 16384 && !/\s/.test(value.accessToken) && typeof value.tokenType === 'string' && value.tokenType.toLowerCase() === 'bearer' && Number.isFinite(value.expiresAt) &&
    (value.refreshToken === undefined || (typeof value.refreshToken === 'string' && value.refreshToken.length > 0 && value.refreshToken.length <= 16384 && !/\s/.test(value.refreshToken))))
}

function boundCredential(value: CloudCredential, config: CloudAuthConfig): boolean {
  return value.version === 1 && value.issuer === config.issuer && value.clientId === config.clientId && value.resource === config.resource && safeText(value.subject) && safeText(value.email) && tokenShape(value.tokens) &&
    (value.authorizationId === undefined || safeText(value.authorizationId)) && (value.uploadConsent === undefined || typeof value.uploadConsent === 'boolean') &&
    (value.verificationPending === undefined || typeof value.verificationPending === 'boolean')
}

async function requestCloudTokens(config: CloudAuthConfig, request: OAuthTokenRequest, fetcher: typeof fetch, now: number): Promise<OAuthTokenSet> {
  if (request.grantType === 'refresh_token' && !config.refreshTokens) throw new Error('Explicit sign-in required.')
  const body = new URLSearchParams({ grant_type: request.grantType, client_id: config.clientId })
  if (request.grantType === 'authorization_code') {
    body.set('code', request.code); body.set('redirect_uri', request.redirectUri); body.set('code_verifier', request.codeVerifier)
  } else body.set('refresh_token', request.refreshToken)
  const response = await fetcher(`${config.issuer}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const value = await response.json()
  if (!response.ok) {
    if (request.grantType === 'refresh_token' && ['invalid_grant', 'invalid_client', 'invalid_scope'].includes(value?.error)) throw new ReconnectRequired()
    throw new Error('Cloud token exchange failed.')
  }
  if (!value || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 60 || typeof value.token_type !== 'string') throw new Error('Invalid cloud token response.')
  const tokens = parseTokenResponse(value, now)
  if (!validTokens(tokens, now)) throw new Error('Invalid cloud token response.')
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, tokenType: tokens.tokenType,
    ...(config.refreshTokens && tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}) }
}
