import type { CloudAuth, CloudCredential } from './cloud-auth'

/** The identity the upload service needs from the shared cloud authorization. */
export type Authorization = Pick<CloudAuth, 'status' | 'setEnabled' | 'credential'> & Partial<Pick<CloudAuth, 'observeAuthorization'>>

/** Consent is bound to the verified account and the exact token observed when it was given. */
export type Consent = { subject: string; token: string }
export type DeleteConsent = Consent & { localId: string }
export type RevokeConsent = Consent & { clientId: string }

export type StoredConsent = {
  upload: Consent | null
  deletion: DeleteConsent | null
  account: Consent | null
  revocation: RevokeConsent | null
}

export function newStoredConsent(): StoredConsent {
  return { upload: null, deletion: null, account: null, revocation: null }
}

export function revokeConsent(stored: StoredConsent): void {
  stored.upload = null
  stored.deletion = null
  stored.account = null
  stored.revocation = null
}

/**
 * Drops consent the account no longer matches. An absent upload consent must not erase an
 * unrelated deletion confirmation, so each is judged on its own.
 */
export function reconcileConsent(stored: StoredConsent, account: { enabled: boolean; subject: string | null }): void {
  if (!account.enabled) {
    revokeConsent(stored)
    return
  }
  for (const key of ['upload', 'deletion', 'account', 'revocation'] as const) {
    const held = stored[key]
    if (held && held.subject !== account.subject) stored[key] = null
  }
}

export function grantedConsent(credential: CloudCredential | null): Consent | null {
  return credential ? { subject: credential.subject, token: credential.tokens.accessToken } : null
}

/** The credential that may write, or null when the consent, account or token no longer match. */
export async function consentedCredential(auth: Authorization, stored: StoredConsent): Promise<CloudCredential | null> {
  const consent = stored.upload
  if (!consent) return null
  const account = await auth.status()
  if (!account.enabled || consent.subject !== account.subject) return null
  const credential = await auth.credential()
  if (!credential || credential.subject !== consent.subject || credential.tokens.accessToken !== consent.token) return null
  return credential
}
