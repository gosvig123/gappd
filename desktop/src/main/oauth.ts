import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export type OAuthTokenSet = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  tokenType: string
  scope?: string
}

export type OAuthConfig = {
  clientId: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  callbackPath: '' | `/${string}`
  authorizeParams?: Record<string, string>
}

export type OAuthDependencies = {
  openExternal(url: string): Promise<unknown>
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

type Loopback = { redirectUri: string; code: Promise<string>; close: () => void }
type Completion = { resolve: (code: string) => void; reject: (error: Error) => void; done: boolean }

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, state: base64Url(randomBytes(32)) }
}

export function buildAuthorizationUrl(config: OAuthConfig, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(config.authorizeUrl)
  const params = { response_type: 'code', client_id: config.clientId, redirect_uri: redirectUri, scope: config.scopes.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, ...config.authorizeParams }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

export async function authorizeOAuth(config: OAuthConfig, dependencies: OAuthDependencies): Promise<OAuthTokenSet> {
  validateConfig(config)
  const pkce = createPkce()
  const loopback = await startLoopback(config.callbackPath, pkce.state, dependencies.timeoutMs)
  void loopback.code.catch(() => undefined)
  try {
    await dependencies.openExternal(buildAuthorizationUrl(config, loopback.redirectUri, pkce.challenge, pkce.state))
    const code = await loopback.code
    return exchangeCode(config, code, loopback.redirectUri, pkce.verifier, dependencies.fetcher, dependencies.now)
  } finally { loopback.close() }
}

export async function refreshOAuthToken(config: OAuthConfig, tokens: OAuthTokenSet, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<OAuthTokenSet> {
  if (!tokens.refreshToken) throw new Error('Reconnect this account to continue.')
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, refresh_token: tokens.refreshToken })
  const refreshed = await requestTokens(config.tokenUrl, body, fetcher, now)
  return { ...refreshed, refreshToken: refreshed.refreshToken || tokens.refreshToken }
}

export function needsTokenRefresh(tokens: OAuthTokenSet, now = Date.now(), skewMs = 60_000): boolean {
  return tokens.expiresAt <= now + skewMs
}

async function exchangeCode(config: OAuthConfig, code: string, redirectUri: string, verifier: string, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<OAuthTokenSet> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, code, redirect_uri: redirectUri, code_verifier: verifier })
  return requestTokens(config.tokenUrl, body, fetcher, now)
}

async function requestTokens(url: string, body: URLSearchParams, fetcher: typeof fetch, now: () => number): Promise<OAuthTokenSet> {
  const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw await tokenResponseError(response)
  const value = await response.json() as Record<string, unknown>
  return parseTokenResponse(value, now())
}

async function tokenResponseError(response: Response): Promise<Error> {
  const payload = await response.clone().json().catch(() => null) as Record<string, unknown> | null
  const code = payload ? safeProviderCode(payload.error) : null
  const hint = payload ? providerErrorHint(payload.error_description) : null
  const detail = [code, hint].filter(Boolean).join('/')
  return new Error(`Authorization token request failed (${response.status}${detail ? `: ${detail}` : ''}).`)
}

function safeProviderCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z_]{1,60}$/.test(value) ? value : null
}

function providerErrorHint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const description = value.toLowerCase()
  if (description.includes('code_verifier')) return 'code_verifier'
  if (description.includes('client_secret')) return 'client_secret'
  if (description.includes('redirect_uri')) return 'redirect_uri'
  return null
}

export function parseTokenResponse(value: Record<string, unknown>, now: number): OAuthTokenSet {
  if (typeof value.access_token !== 'string') throw new Error('Authorization server returned an invalid token response.')
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : 3600
  return { accessToken: value.access_token, refreshToken: optionalString(value.refresh_token), expiresAt: now + expiresIn * 1000, tokenType: optionalString(value.token_type) || 'Bearer', scope: optionalString(value.scope) }
}

async function startLoopback(callbackPath: string, state: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Loopback> {
  const server = createServer()
  await listen(server)
  const port = serverAddressPort(server)
  const completion = createCompletion()
  const expectedHost = `${LOOPBACK_HOST}:${port}`
  server.on('request', (request, response) => handleCallback(request, response, callbackPath, expectedHost, state, completion))
  const timer = setTimeout(() => rejectCompletion(completion, new Error('Authorization timed out.')), timeoutMs)
  const close = () => { clearTimeout(timer); server.close() }
  return { redirectUri: `http://${expectedHost}${callbackPath}`, code: completion.promise, close }
}

function handleCallback(request: IncomingMessage, response: ServerResponse, path: string, host: string, state: string, completion: Completion & { promise: Promise<string> }): void {
  if (request.method !== 'GET') return respond(response, 405, 'Method not allowed')
  if (request.headers.host !== host) return respond(response, 400, 'Invalid callback host')
  const url = new URL(request.url || '/', `http://${host}`)
  if (url.pathname !== (path || '/')) return respond(response, 404, 'Not found')
  const error = url.searchParams.get('error')
  if (error) return finishError(response, completion, `Authorization was not completed (${error}).`)
  if (!safeEqual(url.searchParams.get('state') || '', state)) return finishError(response, completion, 'Authorization state did not match.')
  const code = url.searchParams.get('code')
  if (!code) return finishError(response, completion, 'Authorization code was missing.')
  respond(response, 200, 'Authorization complete. You can return to Gappd.', () => resolveCompletion(completion, code))
}

function createCompletion(): Completion & { promise: Promise<string> } {
  let resolve!: (code: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { resolve, reject, promise, done: false }
}

function resolveCompletion(completion: Completion, code: string): void {
  if (completion.done) return
  completion.done = true
  completion.resolve(code)
}

function rejectCompletion(completion: Completion, error: Error): void {
  if (completion.done) return
  completion.done = true
  completion.reject(error)
}

function finishError(response: ServerResponse, completion: Completion, message: string): void {
  respond(response, 400, message, () => rejectCompletion(completion, new Error(message)))
}

function respond(response: ServerResponse, status: number, message: string, done?: () => void): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  response.end(message, done)
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, LOOPBACK_HOST, () => { server.off('error', reject); resolve() }) })
}

function serverAddressPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Authorization callback could not start.')
  return address.port
}

function validateConfig(config: OAuthConfig): void {
  if (!config.clientId || !config.authorizeUrl || !config.tokenUrl) throw new Error('This service is not configured.')
}

function safeEqual(value: string, expected: string): boolean {
  const left = Buffer.from(value)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
