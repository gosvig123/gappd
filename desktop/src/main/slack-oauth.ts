// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { buildAuthorizationUrl, createPkce, startLoopback, type OAuthConfig } from './oauth.ts'

export const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize'
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access'
export const SLACK_USER_SCOPES = ['chat:write']
export const SLACK_REFRESH_SKEW_MS = 5 * 60 * 1000

const SLACK_CALLBACK_PATH = '/slack/oauth/callback'
const SLACK_CALLBACK_HOST = 'localhost'
const SLACK_CALLBACK_PORT = 45874
export const SLACK_REDIRECT_URI = `http://${SLACK_CALLBACK_HOST}:${SLACK_CALLBACK_PORT}${SLACK_CALLBACK_PATH}`
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000
const SAFE_ERROR = /^[a-z_]{1,60}$/
const RECONNECT_ERRORS = new Set(['invalid_refresh_token', 'token_expired', 'invalid_auth', 'account_inactive'])

/** Thrown when Slack rejects the stored refresh token, so the user must authorize again. */
export class SlackReconnectError extends Error {
  constructor() {
    super('Slack authorization expired. Reconnect Slack to continue.')
    this.name = 'SlackReconnectError'
  }
}

export type SlackTokenSet = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  refreshExpiresAt: number
  scope: string
  teamId: string
  userId: string
}

export type SlackTokenDependencies = {
  fetcher?: typeof fetch
  now?: () => number
}

export type SlackOAuthDependencies = SlackTokenDependencies & {
  openExternal(url: string): Promise<unknown>
  timeoutMs?: number
  /** Tests use an ephemeral loopback port; the shipped app uses the registered port. */
  callbackPort?: number
}

type SlackCodeExchange = { code: string; redirectUri: string; codeVerifier: string }

export function slackOAuthConfig(clientId: string): OAuthConfig {
  return {
    clientId,
    authorizeUrl: SLACK_AUTHORIZE_URL,
    tokenUrl: SLACK_TOKEN_URL,
    scopes: [],
    callbackPath: SLACK_CALLBACK_PATH,
    authorizeParams: { user_scope: SLACK_USER_SCOPES.join(',') },
  }
}

export async function authorizeSlack(clientId: string, dependencies: SlackOAuthDependencies): Promise<SlackTokenSet> {
  if (!clientId) throw new Error('Slack is not configured for this build.')
  const config = slackOAuthConfig(clientId)
  const pkce = createPkce()
  const loopback = await startLoopback(config.callbackPath, pkce.state, {
    timeoutMs: dependencies.timeoutMs,
    callbackHost: SLACK_CALLBACK_HOST,
    callbackPort: dependencies.callbackPort ?? SLACK_CALLBACK_PORT,
  })
  void loopback.code.catch(() => undefined)
  try {
    await dependencies.openExternal(buildAuthorizationUrl(config, loopback.redirectUri, pkce.challenge, pkce.state))
    const code = await loopback.code
    return await exchangeSlackCode(config, { code, redirectUri: loopback.redirectUri, codeVerifier: pkce.verifier }, dependencies)
  } finally {
    loopback.close()
  }
}

export function exchangeSlackCode(config: OAuthConfig, exchange: SlackCodeExchange, dependencies: SlackTokenDependencies): Promise<SlackTokenSet> {
  return postSlackTokens({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code: exchange.code,
    redirect_uri: exchange.redirectUri,
    code_verifier: exchange.codeVerifier,
  }, dependencies)
}

export function refreshSlackTokens(clientId: string, refreshToken: string, dependencies: SlackTokenDependencies): Promise<SlackTokenSet> {
  return postSlackTokens({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }, dependencies)
}

export function parseSlackTokens(value: Record<string, unknown>, now: number): SlackTokenSet {
  const user = recordValue(value.authed_user)
  const accessToken = stringValue(user.access_token) ?? stringValue(value.access_token)
  const refreshToken = stringValue(user.refresh_token) ?? stringValue(value.refresh_token)
  const expiresIn = numberValue(user.expires_in) ?? numberValue(value.expires_in)
  if (!accessToken || !refreshToken || expiresIn === null) {
    throw new Error('Slack did not return a rotating user token. Enable Token Rotation for the Slack app, then connect again.')
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    refreshExpiresAt: now + REFRESH_TOKEN_LIFETIME_MS,
    scope: stringValue(user.scope) ?? stringValue(value.scope) ?? '',
    teamId: stringValue(recordValue(value.team).id) ?? '',
    userId: stringValue(user.id) ?? '',
  }
}

async function postSlackTokens(fields: Record<string, string>, dependencies: SlackTokenDependencies): Promise<SlackTokenSet> {
  const fetcher = dependencies.fetcher || fetch
  const now = dependencies.now || Date.now
  let response: Response
  try {
    response = await fetcher(SLACK_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error('Slack could not be reached. Check your connection and try again.')
  }
  const value = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok || !value || value.ok !== true) throw slackError(value)
  return parseSlackTokens(value, now())
}

function slackError(value: Record<string, unknown> | null): Error {
  const code = value && typeof value.error === 'string' && SAFE_ERROR.test(value.error) ? value.error : 'slack_error'
  if (RECONNECT_ERRORS.has(code)) return new SlackReconnectError()
  return new Error(`Slack rejected the authorization request (${code}).`)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
