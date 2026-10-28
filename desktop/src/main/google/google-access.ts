import type { GoogleAccess } from '../../shared/calendar-contract'

const ACCESS_SCOPES: Record<GoogleAccess, string> = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
}
/** Access Google has not verified for `gappd-production`, with the switch that allows it in a development run. */
const REVIEW_SWITCHES: Partial<Record<GoogleAccess, string>> = { gmail: 'GAPPD_GMAIL_REVIEW' }

export function accessScopes(access: readonly GoogleAccess[]): string[] {
  return access.map((item) => ACCESS_SCOPES[item])
}

/** Reads the access an account granted from the space-separated scope of its tokens. */
export function grantedAccess(scope: string | undefined): GoogleAccess[] {
  const granted = new Set((scope ?? '').split(/\s+/))
  return googleAccessKinds().filter((item) => granted.has(ACCESS_SCOPES[item]))
}

export function parseGoogleAccess(value: unknown): GoogleAccess[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => !googleAccessKinds().includes(item))) throw new Error('Invalid Google access choice.')
  return [...new Set(value as GoogleAccess[])]
}

/**
 * Google approved Contacts on 28 October 2026 but has not verified Gmail, and it forbids
 * unverified scopes in production traffic. Every build offers verified access; only an
 * unpackaged development run with a review switch may request unverified access.
 */
export function reviewGoogleAccess(packaged: boolean, env: NodeJS.ProcessEnv): GoogleAccess[] {
  return googleAccessKinds().filter((item) => {
    const reviewSwitch = REVIEW_SWITCHES[item]
    return !reviewSwitch || (!packaged && env[reviewSwitch] === '1')
  })
}

function googleAccessKinds(): GoogleAccess[] {
  return Object.keys(ACCESS_SCOPES) as GoogleAccess[]
}
