import type { GoogleAccess } from '../../shared/calendar-contract'

const ACCESS_SCOPES: Record<GoogleAccess, string> = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
}
const REVIEW_SWITCHES: Record<GoogleAccess, string> = { gmail: 'GAPPD_GMAIL_REVIEW', contacts: 'GAPPD_CONTACTS_REVIEW' }

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
 * Google has not verified the Gmail and Contacts scopes, and it forbids unverified scopes in
 * production traffic. Only an unpackaged development run with a review switch may request them.
 */
export function reviewGoogleAccess(packaged: boolean, env: NodeJS.ProcessEnv): GoogleAccess[] {
  if (packaged) return []
  return googleAccessKinds().filter((item) => env[REVIEW_SWITCHES[item]] === '1')
}

function googleAccessKinds(): GoogleAccess[] {
  return Object.keys(ACCESS_SCOPES) as GoogleAccess[]
}
