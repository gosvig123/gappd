// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { requestTokens } from './oauth-tokens.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
export { parseTokenResponse } from './oauth-tokens.ts'
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

export type OAuthTokenRequest =
  | { grantType: 'authorization_code'; code: string; redirectUri: string; codeVerifier: string }
  | { grantType: 'refresh_token'; refreshToken: string }

export type OAuthTokenRequester = (request: OAuthTokenRequest) => Promise<OAuthTokenSet>

export type OAuthConfig = {
  clientId: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  callbackPath: '' | `/${string}`
  authorizeParams?: Record<string, string>
  issuer?: string
}

export type OAuthDependencies = {
  openExternal(url: string): Promise<unknown>
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
  signal?: AbortSignal
  tokenRequester?: OAuthTokenRequester
}

type Loopback = { redirectUri: string; code: Promise<string>; close: () => void }

export type LoopbackOptions = { timeoutMs?: number; callbackHost?: string; callbackPort?: number; issuer?: string }
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
  dependencies.signal?.throwIfAborted()
  validateConfig(config)
  const pkce = createPkce()
  const loopback = await startLoopback(config.callbackPath, pkce.state, { timeoutMs: dependencies.timeoutMs, issuer: config.issuer })
  void loopback.code.catch(() => undefined)
  const abort = () => loopback.close()
  dependencies.signal?.addEventListener('abort', abort, { once: true })
  try {
    dependencies.signal?.throwIfAborted()
    await dependencies.openExternal(buildAuthorizationUrl(config, loopback.redirectUri, pkce.challenge, pkce.state))
    const code = await loopback.code
    const request: OAuthTokenRequest = { grantType: 'authorization_code', code, redirectUri: loopback.redirectUri, codeVerifier: pkce.verifier }
    if (dependencies.tokenRequester) return dependencies.tokenRequester(request)
    return exchangeCode(config, code, loopback.redirectUri, pkce.verifier, dependencies.fetcher, dependencies.now)
  } finally { dependencies.signal?.removeEventListener('abort', abort); loopback.close() }
}

export async function refreshOAuthToken(config: OAuthConfig, tokens: OAuthTokenSet, fetcher: typeof fetch = fetch, now: () => number = Date.now, tokenRequester?: OAuthTokenRequester): Promise<OAuthTokenSet> {
  if (!tokens.refreshToken) throw new Error('Reconnect this account to continue.')
  const request: OAuthTokenRequest = { grantType: 'refresh_token', refreshToken: tokens.refreshToken }
  const refreshed = tokenRequester
    ? await tokenRequester(request)
    : await requestTokens(config.tokenUrl, new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, refresh_token: tokens.refreshToken }), fetcher, now)
  return { ...refreshed, refreshToken: refreshed.refreshToken || tokens.refreshToken }
}

export function needsTokenRefresh(tokens: OAuthTokenSet, now = Date.now(), skewMs = 60_000): boolean {
  return tokens.expiresAt <= now + skewMs
}

async function exchangeCode(config: OAuthConfig, code: string, redirectUri: string, verifier: string, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<OAuthTokenSet> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, code, redirect_uri: redirectUri, code_verifier: verifier })
  return requestTokens(config.tokenUrl, body, fetcher, now)
}

export async function startLoopback(callbackPath: string, state: string, options: LoopbackOptions = {}): Promise<Loopback> {
  const server = createServer()
  await listen(server, options.callbackPort || 0)
  const port = serverAddressPort(server)
  const completion = createCompletion()
  const expectedHost = `${options.callbackHost || LOOPBACK_HOST}:${port}`
  server.on('request', (request, response) => handleCallback(request, response, callbackPath, expectedHost, state, completion, options.issuer))
  const timer = setTimeout(() => rejectCompletion(completion, new Error('Authorization timed out.')), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const close = () => { clearTimeout(timer); rejectCompletion(completion, new Error('Authorization cancelled.')); server.close() }
  return { redirectUri: `http://${expectedHost}${callbackPath}`, code: completion.promise, close }
}

function handleCallback(request: IncomingMessage, response: ServerResponse, path: string, host: string, state: string, completion: Completion & { promise: Promise<string> }, issuer?: string): void {
  if (request.method !== 'GET') return respond(response, 405, 'Method not allowed')
  if (request.headers.host !== host) return respond(response, 400, 'Invalid callback host')
  let url: URL
  try { url = new URL(request.url || '/', `http://${host}`) }
  catch { return respond(response, 400, 'Invalid callback URL') }
  if (url.pathname !== (path || '/')) return respond(response, 404, 'Not found')
  if (!safeEqual(url.searchParams.get('state') || '', state)) return finishError(response, completion, 'Authorization state did not match.')
  if (['state', 'code', 'error', 'iss'].some(key => url.searchParams.getAll(key).length > 1)) return finishError(response, completion, 'Invalid authorization callback.')
  if (issuer && url.searchParams.get('iss') !== issuer) return finishError(response, completion, 'Authorization issuer did not match.')
  if (url.searchParams.has('error')) return finishError(response, completion, 'Authorization was not completed. Try again.')
  const code = url.searchParams.get('code')
  if (!code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) return finishError(response, completion, 'Authorization code was missing or invalid.')
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

async function listen(server: Server, port = 0): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, LOOPBACK_HOST, () => { server.off('error', reject); resolve() }) })
  } catch (error) {
    if (port && isAddressInUse(error)) throw new Error(`Authorization could not start because local port ${port} is in use.`)
    throw error
  }
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE')
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
