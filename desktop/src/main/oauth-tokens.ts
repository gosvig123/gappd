import type { OAuthTokenSet } from './oauth'

export async function requestTokens(url: string, body: URLSearchParams, fetcher: typeof fetch, now: () => number): Promise<OAuthTokenSet> {
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
