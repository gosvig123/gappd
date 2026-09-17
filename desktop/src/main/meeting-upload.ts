import type { MeetingUploadStatus } from '../shared/meeting-upload-contract'
import type { MeetingListItem } from '../shared/contracts'
import type { CloudAuth, CloudCredential } from './cloud-auth'
import type { MeetingDevice } from './meeting-device'
import type { MeetingSyncQueue } from './meeting-sync-queue'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { consentedCredential, grantedConsent, newStoredConsent, reconcileConsent, revokeConsent, type Authorization, type DeleteConsent, type StoredConsent } from './meeting-upload-consent.ts'

/**
 * Sends queued Meeting copies to Gappd Cloud.
 *
 * Signing in never permits an upload: a separate, explicit consent is required, it is bound to
 * the account, and it is dropped when the account or its token changes or when sync is turned
 * off. The queue owns the revision, the exact accepted bytes, and the account it belongs to, so
 * neither queued work nor an acceptance ever crosses accounts.
 */
export class MeetingUpload {
  private readonly auth: Authorization
  private readonly resource: string
  private readonly available: boolean
  private readonly queue: MeetingSyncQueue
  private readonly loadDocument: (localId: string, revision: number) => Promise<string>
  private readonly localMeetings: () => Promise<MeetingListItem[]>
  private readonly device: MeetingDevice
  private readonly fetcher: typeof fetch
  private generation = 0
  private readonly stored: StoredConsent = newStoredConsent()
  private pending: AbortController | null = null
  private result: string | null = null
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private refreshing: Promise<void> | null = null
  private syncing: Promise<void> | null = null

  constructor(auth: Authorization, resource: string, available: boolean, queue: MeetingSyncQueue,
    loadDocument: (localId: string, revision: number) => Promise<string>, localMeetings: () => Promise<MeetingListItem[]>,
    device: MeetingDevice, fetcher: typeof fetch = fetch) {
    this.auth = auth
    this.resource = resource
    this.available = available
    this.queue = queue
    this.loadDocument = loadDocument
    this.localMeetings = localMeetings
    this.device = device
    this.fetcher = fetcher
    auth.observeAuthorization?.(() => this.revokeAll())
  }

  async status(): Promise<MeetingUploadStatus> {
    const account = await this.auth.status()
    reconcileConsent(this.stored, account)
    if (!this.stored.upload) this.stopRetryTimer()
    return {
      available: this.available, account, consent: Boolean(this.stored.upload),
      deleteConsent: Boolean(this.stored.deletion), accountDeleteConsent: Boolean(this.stored.account),
      revokeConsent: Boolean(this.stored.revocation), sending: Boolean(this.pending), result: this.result,
      queue: await this.queue.status(),
    }
  }

  /** The sync toggle. Turning it off drops consent and cancels locally; it never deletes a copy. */
  async connect(enabled: unknown): Promise<MeetingUploadStatus> {
    if (typeof enabled !== 'boolean') throw new Error('Boolean required.')
    if (enabled && !this.available) throw new Error('Cloud Meeting upload is disabled.')
    this.revokeAll()
    await this.auth.setEnabled(enabled)
    return this.status()
  }

  async setConsent(subject: unknown, enabled: unknown): Promise<MeetingUploadStatus> {
    const credential = await this.verified(subject, enabled)
    this.stored.upload = grantedConsent(credential)
    this.stopRetryTimer()
    if (credential) {
      // ponytail: scan completed Meetings once per minute; use a change journal if history size makes exports costly.
      this.retryTimer = setInterval(() => {
        void this.syncNew().catch((error) => console.error('Automatic Meeting sync failed; retrying next minute', error))
      }, 60_000)
      this.retryTimer.unref()
      await this.refresh(true)
    }
    return this.status()
  }

  /** Deletion is destructive, so it keeps its own one-use confirmation for one Meeting. */
  async setDeleteConsent(subject: unknown, enabled: unknown, localId: unknown): Promise<MeetingUploadStatus> {
    if (typeof localId !== 'string' || localId.length === 0) throw new Error('Invalid consent.')
    const credential = await this.verified(subject, enabled)
    this.stored.deletion = credential ? { subject: credential.subject, token: credential.tokens.accessToken, localId } : null
    return this.status()
  }

  /** Queues one local Meeting. It sends nothing: sync does that, and only with consent. */
  async enqueue(localId: unknown): Promise<MeetingUploadStatus> {
    if (!this.available) throw new Error('Cloud Meeting upload is disabled.')
    if (typeof localId !== 'string' || localId.length === 0) throw new Error('A Meeting is required.')
    await this.queue.enqueue(localId, (revision) => this.loadDocument(localId, revision))
    return this.status()
  }

  /** Sends queued copies while consent, the account and the capability all still hold. */
  async sync(): Promise<MeetingUploadStatus> {
    if (this.syncing) await this.syncing
    else if (this.available && !this.pending) {
      this.syncing = syncUploads(this.context())
      try { await this.syncing } finally { this.syncing = null }
    }
    return this.status()
  }

  async deleteCopy(subject: unknown, localId: unknown): Promise<MeetingUploadStatus> {
    const held = this.stored.deletion
    if (!this.writable() || typeof subject !== 'string' || typeof localId !== 'string') throw new Error('Cloud copy unavailable.')
    // A confirmation for another Meeting, or for another account, is not consumed by this call.
    if (!held || held.subject !== subject || held.localId !== localId) return this.status()
    this.stored.deletion = null
    await deleteCloudCopy(this.context(), subject, localId)
    return this.status()
  }

  /** Erasing every copy is destructive, so it keeps its own one-use confirmation. */
  async setAccountDeleteConsent(subject: unknown, enabled: unknown): Promise<MeetingUploadStatus> {
    this.stored.account = grantedConsent(await this.verified(subject, enabled))
    return this.status()
  }

  /** Revoking a client is destructive, so it names that client in its own confirmation. */
  async setRevokeConsent(subject: unknown, enabled: unknown, clientId: unknown): Promise<MeetingUploadStatus> {
    if (typeof clientId !== 'string' || clientId.trim() !== clientId || clientId.length === 0 || clientId.length > 256) {
      throw new Error('Invalid client.')
    }
    const credential = await this.verified(subject, enabled)
    this.stored.revocation = credential ? { subject: credential.subject, token: credential.tokens.accessToken, clientId } : null
    return this.status()
  }

  /** Erases every cloud copy of this account and closes uploads until a new consent. */
  async deleteAll(): Promise<MeetingUploadStatus> {
    const held = this.stored.account
    if (!this.writable() || !held) return this.status()
    this.stored.account = null
    await deleteAllCloudData(this.context(), held.subject)
    return this.status()
  }

  /** Opens uploads again and remembers the generation only this Mac will know. */
  async allowUploads(): Promise<MeetingUploadStatus> {
    const credential = await this.consented()
    if (!this.writable() || !credential) return this.status()
    await allowUploadsAgain(this.context(), credential.subject)
    return this.status()
  }

  /** The clients that have used this account, so revocation offers a choice instead of a guess. */
  async knownClients(): Promise<string[]> {
    if (!this.available) return []
    return listKnownClients(this.context())
  }

  /** Cuts one client's access to this account. Stored copies are not touched. */
  async revokeClient(subject: unknown, clientId: unknown): Promise<MeetingUploadStatus> {
    const held = this.stored.revocation
    if (!this.writable() || typeof subject !== 'string' || typeof clientId !== 'string') throw new Error('Revocation unavailable.')
    if (!held || held.subject !== subject || held.clientId !== clientId) return this.status()
    this.stored.revocation = null
    await revokeClientAccess(this.context(), subject, clientId)
    return this.status()
  }

  /** Processing events and the background timer share one discovery pass. */
  syncNew(): Promise<void> {
    return this.refresh(false)
  }

  private refresh(announce: boolean): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshMeetings(announce).finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async refreshMeetings(announce: boolean): Promise<void> {
    if (!this.available) return
    const generation = this.generation
    const credential = await this.consented()
    if (!credential || generation !== this.generation) return
    const { queued, unreadable } = await this.enqueueMissing(credential)
    if (generation !== this.generation || !await this.consented()) return
    // Retry durable pending work even when discovery found no new Meeting.
    if ((await this.queue.status()).pending > 0) await this.sync()
    if (announce && (queued > 0 || unreadable > 0) && generation === this.generation) {
      this.result = backfillMessage(queued, unreadable, await this.queue.status())
    }
  }

  /**
   * Queues every new or changed finished record. Naming the account first is
   * what makes the queue safe to reuse: another account's watermark and queued work are dropped
   * before this one's history is read, so no Meeting is skipped and none is sent to the wrong
   * account. A Meeting that is still recording or still processing is not a finished record.
   * Expired or deleted cloud copies are never recreated; the server rejects those identities.
   */
  private async enqueueMissing(credential: CloudCredential): Promise<{ queued: number; unreadable: number }> {
    await this.queue.claim(credential.subject)
    const meetings = await this.localMeetings()
    const finished = meetings.filter((meeting) => meeting.status.state === 'completed').map((meeting) => meeting.id)
    return this.queue.backfill(finished, (localId, revision) => this.loadDocument(localId, revision))
  }

  /** Everything the wire modules need, without giving them the consent state. */
  private context(): UploadContext {
    return {
      resource: this.resource, device: this.device, queue: this.queue, fetcher: this.fetcher,
      consented: () => this.consented(),
      setPending: (controller) => { this.pending = controller },
      setResult: (message) => { this.result = message },
      rememberGeneration: (generation) => this.device.rememberGeneration(generation),
    }
  }

  private writable(): boolean {
    return this.available && !this.pending && !this.syncing
  }

  private async verified(subject: unknown, enabled: unknown): Promise<CloudCredential | null> {
    if (typeof enabled !== 'boolean' || typeof subject !== 'string') throw new Error('Invalid consent.')
    this.cancelPending()
    if (!enabled || !this.available) return null
    const generation = this.generation
    const credential = await this.auth.credential()
    return generation === this.generation && credential?.subject === subject ? credential : null
  }

  private consented(): Promise<CloudCredential | null> {
    return consentedCredential(this.auth, this.stored)
  }

  // Stops in-flight work without touching a consent the user did not change.
  private cancelPending(): void {
    this.generation++
    if (this.pending) this.result = 'Cancelled locally. The server may already have accepted the request; sync off does not request deletion.'
    this.pending?.abort()
    this.pending = null
  }

  // Turning sync off or changing the account revokes every consent.
  private revokeAll(): void {
    this.cancelPending()
    this.stopRetryTimer()
    revokeConsent(this.stored)
  }

  private stopRetryTimer(): void {
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.retryTimer = null
  }
}

function backfillMessage(queued: number, unreadable: number, queue: MeetingUploadStatus['queue']): string {
  const parts = [`Queued ${queued} existing ${queued === 1 ? 'Meeting' : 'Meetings'} for upload.`]
  if (unreadable > 0) parts.push(`${unreadable} could not be read yet and stay on this Mac.`)
  if (queue.pending > 0) parts.push(`${queue.pending} still queued; sync retries automatically while consent remains active.`)
  if (queue.failed > 0) parts.push(`${queue.failed} failed and will not retry.`)
  return parts.join(' ')
}
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { acceptedMessage } from './meeting-upload-ack.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { allowUploadsAgain, deleteAllCloudData, listKnownClients, revokeClientAccess } from './meeting-upload-actions.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { deleteCloudCopy } from './meeting-upload-delete.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { syncUploads } from './meeting-upload-sync.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import type { UploadContext } from './meeting-upload-context.ts'
