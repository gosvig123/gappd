import type { CloudAuth, CloudCredential } from './cloud-auth'

/** The identity the upload service needs from the shared cloud authorization. */
export type Authorization = Pick<CloudAuth, 'status' | 'setEnabled' | 'credential'> & Partial<Pick<CloudAuth, 'observeAuthorization' | 'savedUploadCredential' | 'setUploadConsent'>>

/** Upload consent can follow a saved authorization through token refresh. Other actions stay one-use. */
export type Consent = { subject: string; token: string; authorizationId?: string }
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
    // A temporary offline or locked credential store must not erase saved upload intent.
    stored.deletion = stored.account = stored.revocation = null
    return
  }
  for (const key of ['upload', 'deletion', 'account', 'revocation'] as const) {
    const held = stored[key]
    if (held && held.subject !== account.subject) stored[key] = null
  }
}

export function grantedConsent(credential: CloudCredential | null): Consent | null {
  return credential ? { subject: credential.subject, token: credential.tokens.accessToken, authorizationId: credential.authorizationId } : null
}

/** Refresh may change the token, but never the verified account or saved authorization. */
export async function consentedCredential(auth: Authorization, stored: StoredConsent): Promise<CloudCredential | null> {
  const consent = stored.upload
  if (!consent) return null
  const account = await auth.status()
  if (!account.enabled || consent.subject !== account.subject) return null
  const credential = await auth.credential()
  if (stored.upload !== consent || !credential || credential.subject !== consent.subject || credential.uploadConsent === false) return null
  const matches = consent.authorizationId
    ? credential.uploadConsent === true && credential.authorizationId === consent.authorizationId
    : credential.tokens.accessToken === consent.token
  return matches ? credential : null
}
