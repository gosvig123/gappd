import type { CloudCredential } from './cloud-auth'

/**
 * Acknowledgment checks for the Upload API. An acknowledgment is accepted only when it names
 * the same account and the same revision that was sent, so a stale or foreign response cannot
 * be mistaken for this device's upload.
 */

export function accepted(value: unknown, credential: CloudCredential, revision: number): value is { expires_at: string } {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return result.status === 'accepted' && result.subject === credential.subject && result.revision === revision &&
    typeof result.id === 'string' && typeof result.expires_at === 'string' && Number.isFinite(Date.parse(result.expires_at))
}

export function deletedAcknowledged(value: unknown, credential: CloudCredential): boolean {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return result.status === 'deleted' && result.subject === credential.subject
}

export function acceptedMessage(credential: CloudCredential, work: { revision: number }, expiresAt: string): string {
  return `Uploaded a Meeting copy for ${credential.email} (${credential.subject}) at revision ${work.revision}. It expires at ${expiresAt}. Turning sync off stops new uploads and does not delete this copy.`
}
