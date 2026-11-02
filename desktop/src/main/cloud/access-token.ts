import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto'

// Remote access checks each caller's token on this Mac, with the same rules as the cloud: a relay
// that makes up a request cannot pass, because it cannot sign a token.

const SCOPE = 'meetings:read'
const KEY_TTL_MS = 5 * 60_000
// A token with an unknown key fetches the key set again at most this often.
const KEY_RETRY_MS = 10_000
const MAX_KEYS_BYTES = 128 << 10
const FETCH_TIMEOUT_MS = 5_000
// Allowed difference between this Mac's clock and the issuer's.
const CLOCK_SKEW_S = 30

type Claims = { iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; iat?: unknown; nbf?: unknown; scope?: unknown; scp?: unknown }

export type AccessTokenRules = { issuer: string; resource: string; subject: string }

export class AccessTokenVerifier {
  private keys = new Map<string, KeyObject>()
  private fetchedAt = 0
  private nextFetchAt = 0
  private fetching: Promise<void> | null = null
  private readonly fetcher: typeof fetch
  private readonly now: () => number

  constructor(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
    this.fetcher = fetcher; this.now = now
  }

  /** Reports whether token is a valid Meeting read token, issued by issuer, for this account. */
  async verify(token: string, rules: AccessTokenRules): Promise<boolean> {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const header = decodePart(parts[0]) as { alg?: unknown; typ?: unknown; kid?: unknown } | null
    const claims = decodePart(parts[1]) as Claims | null
    if (!header || !claims || header.alg !== 'RS256' || (header.typ !== 'at+jwt' && header.typ !== 'application/at+jwt')) return false
    if (typeof header.kid !== 'string' || header.kid === '') return false
    const key = await this.key(rules.issuer, header.kid)
    if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) return false
    return validClaims(claims, rules, this.now() / 1000)
  }

  private async key(issuer: string, kid: string): Promise<KeyObject | null> {
    const age = this.now() - this.fetchedAt
    if (this.now() >= this.nextFetchAt && (age > KEY_TTL_MS || !this.keys.has(kid))) {
      this.nextFetchAt = this.now() + KEY_RETRY_MS
      this.fetching ||= this.fetchKeys(issuer).finally(() => { this.fetching = null })
    }
    await this.fetching
    return this.keys.get(kid) ?? null
  }

  // A failed fetch keeps the last good keys, and waits KEY_RETRY_MS before the next try.
  private async fetchKeys(issuer: string): Promise<void> {
    try {
      const response = await this.fetcher(`${issuer}/.well-known/jwks.json`, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      const text = await response.text()
      if (!response.ok || text.length > MAX_KEYS_BYTES) throw new Error('key set unavailable')
      const { keys } = JSON.parse(text) as { keys?: Array<JsonWebKey & { kid?: unknown }> }
      const next = new Map<string, KeyObject>()
      for (const jwk of Array.isArray(keys) ? keys : []) {
        if (jwk.kty === 'RSA' && typeof jwk.kid === 'string') next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }))
      }
      this.keys = next
      this.fetchedAt = this.now()
    } catch {
      this.nextFetchAt = this.now() + KEY_RETRY_MS
    }
  }
}

function validClaims(claims: Claims, rules: AccessTokenRules, now: number): boolean {
  const audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
  if (claims.iss !== rules.issuer || !Array.isArray(audience) || audience.length !== 1 || audience[0] !== rules.resource) return false
  if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub !== rules.subject) return false
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_S <= now) return false
  for (const value of [claims.nbf, claims.iat]) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value - CLOCK_SKEW_S > now)) return false
  }
  return hasScope(claims)
}

// The same scope rule as the cloud: a scp array wins, and a scope claim must be a string.
function hasScope(claims: Claims): boolean {
  if (claims.scope !== undefined && typeof claims.scope !== 'string') return false
  if (claims.scp !== undefined) return Array.isArray(claims.scp) && claims.scp.every((value) => typeof value === 'string') && claims.scp.includes(SCOPE)
  return typeof claims.scope === 'string' && claims.scope.split(' ').includes(SCOPE)
}

function decodePart(part: string): unknown {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}
