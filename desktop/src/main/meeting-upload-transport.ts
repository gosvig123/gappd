import type { MeetingSyncWork } from '../shared/meeting-sync-contract'
import type { CloudCredential } from './cloud-auth'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { accepted, deletedAcknowledged } from './meeting-upload-ack.ts'

/** The outcome of one upload attempt. Only `unavailable` is worth retrying. */
export type SendOutcome = { kind: 'accepted'; expiresAt: string } | { kind: 'refused' } | { kind: 'unavailable' }

const TIMEOUT_MS = 15_000

/**
 * Uploads one queued document. Nothing is retried here and no state is changed: the caller
 * decides what an outcome means for the queue.
 */
export async function sendDocument(fetcher: typeof fetch, resource: string, credential: CloudCredential,
  work: MeetingSyncWork, signal: AbortSignal): Promise<SendOutcome> {
  try {
    const response = await fetcher(new URL('/meeting', resource), {
      method: 'POST', body: work.document, redirect: 'error',
      headers: { Authorization: `Bearer ${credential.tokens.accessToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    // A refusal is about this document, so retrying it can never help.
    if (response.status === 400) return { kind: 'refused' }
    const value: unknown = await response.json()
    if (!response.ok || !accepted(value, credential, work.revision)) return { kind: 'unavailable' }
    return { kind: 'accepted', expiresAt: value.expires_at }
  } catch {
    return { kind: 'unavailable' }
  }
}

/** Deletes one cloud copy. Absent and other-owner copies answer the same way. */
export async function sendDelete(fetcher: typeof fetch, resource: string, credential: CloudCredential,
  localId: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetcher(new URL('/meeting', resource), {
      method: 'DELETE', body: JSON.stringify({ meeting_id: localId }), redirect: 'error',
      headers: { Authorization: `Bearer ${credential.tokens.accessToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    const value: unknown = await response.json()
    return response.ok && deletedAcknowledged(value, credential)
  } catch {
    return false
  }
}
