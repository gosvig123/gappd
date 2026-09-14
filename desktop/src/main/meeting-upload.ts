import type { MeetingUploadStatus } from '../shared/meeting-upload-contract'
import type { MeetingSyncWork } from '../shared/meeting-sync-contract'
import type { CloudAuth, CloudCredential } from './cloud-auth'
import type { MeetingDevice } from './meeting-device'
import type { MeetingSyncQueue } from './meeting-sync-queue'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { consentedCredential, grantedConsent, newStoredConsent, reconcileConsent, revokeConsent, type Authorization, type DeleteConsent, type StoredConsent } from './meeting-upload-consent.ts'

/** One sync call sends at most this many Meetings, so a call cannot loop without end. */
const MAX_SENDS_PER_SYNC = 5

/**
 * Sends queued Meeting copies to Gappd Cloud.
 *
 * Signing in never permits an upload: a separate, explicit consent is required, it is bound to
 * the account, and it is dropped when the account or its token changes or when sync is turned
 * off. The queue owns the revision and the exact accepted bytes.
 */
export class MeetingUpload {
  private readonly auth: Authorization
  private readonly resource: string
  private readonly available: boolean
  private readonly queue: MeetingSyncQueue
  private readonly loadDocument: (localId: string, revision: number) => Promise<string>
  private readonly device: MeetingDevice
  private readonly fetcher: typeof fetch
  private generation = 0
  private readonly stored: StoredConsent = newStoredConsent()
  private pending: AbortController | null = null
  private result: string | null = null

  constructor(auth: Authorization, resource: string, available: boolean, queue: MeetingSyncQueue,
    loadDocument: (localId: string, revision: number) => Promise<string>, device: MeetingDevice,
    fetcher: typeof fetch = fetch) {
    this.auth = auth
    this.resource = resource
    this.available = available
    this.queue = queue
    this.loadDocument = loadDocument
    this.device = device
    this.fetcher = fetcher
    auth.observeAuthorization?.(() => this.revokeAll())
  }

  async status(): Promise<MeetingUploadStatus> {
    const account = await this.auth.status()
    reconcileConsent(this.stored, account)
    return {
      available: this.available, account, consent: Boolean(this.stored.upload),
      deleteConsent: Boolean(this.stored.deletion), sending: Boolean(this.pending), result: this.result, queue: await this.queue.status(),
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
    this.stored.upload = grantedConsent(await this.verified(subject, enabled))
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
    if (!this.available || this.pending) return this.status()
    const credential = await this.consented()
    if (!credential) return this.status()
    const controller = new AbortController()
    this.pending = controller
    const generation = ++this.generation
    try {
      if (!await this.ensureRegistered(credential, controller.signal)) return this.status()
      await this.drain(credential, controller, generation)
    } finally {
      if (generation === this.generation) this.pending = null
    }
    return this.status()
  }

  async deleteCopy(subject: unknown, localId: unknown): Promise<MeetingUploadStatus> {
    if (!this.available || this.pending || typeof subject !== 'string' || typeof localId !== 'string') {
      throw new Error('Cloud copy unavailable.')
    }
    const consent: DeleteConsent | null = this.stored.deletion
    // A confirmation for another Meeting, or for another account, is not consumed by this call.
    if (!consent || consent.subject !== subject || consent.localId !== localId) return this.status()
    this.stored.deletion = null
    await deleteCloudCopy({
      resource: this.resource, device: this.device, fetcher: this.fetcher,
      consented: () => this.consented(),
      ensureRegistered: (credential, signal) => this.ensureRegistered(credential, signal),
      setPending: (controller) => { this.pending = controller },
      setResult: (message) => { this.result = message },
    }, subject, localId)
    return this.status()
  }

  /**
   * Registers this Mac's device once per credential. Every write needs the signature it makes
   * possible, so an unregistered device can never write.
   */
  private async ensureRegistered(credential: CloudCredential, signal: AbortSignal): Promise<boolean> {
    if (this.device.isRegistered()) return true
    const body = await this.device.registrationBody()
    if (!await sendRegistration(this.fetcher, this.resource, credential, body, signal)) {
      this.result = 'This Mac could not register for uploads, so nothing was sent.'
      return false
    }
    this.device.markRegistered()
    return true
  }

  private async drain(credential: CloudCredential, controller: AbortController, generation: number): Promise<void> {
    for (let sent = 0; sent < MAX_SENDS_PER_SYNC; sent++) {
      const work = await this.queue.pending()
      if (!work || generation !== this.generation) return
      if (!await this.sendOne(credential, controller, work)) return
    }
  }

  private async sendOne(credential: CloudCredential, controller: AbortController, work: MeetingSyncWork): Promise<boolean> {
    const signatures = await this.device.signatures('POST', '/meeting', work.document)
    const outcome = await sendDocument(this.fetcher, this.resource, credential, signatures, work, controller.signal)
    if (outcome.kind === 'accepted') {
      await this.queue.succeed(work.localId, work.revision)
      this.result = acceptedMessage(credential, work, outcome.expiresAt)
      return true
    }
    if (outcome.kind === 'refused') {
      await this.queue.reject(work.localId, work.revision, 'The server refused this Meeting document. Recording it again will not help.')
      this.result = 'The server refused one Meeting document. Other queued Meetings are unaffected.'
      return true
    }
    await this.queue.fail(work.localId, work.revision, 'No acknowledgment from Gappd Cloud.')
    this.result = 'No acknowledgment. The server may have accepted the copy; it will be retried. A cloud copy is never deleted by turning sync off.'
    return false
  }

  private async verified(subject: unknown, enabled: unknown): Promise<CloudCredential | null> {
    if (typeof enabled !== 'boolean' || typeof subject !== 'string') throw new Error('Invalid consent.')
    this.cancelPending()
    if (!enabled || !this.available) return null
    const credential = await this.auth.credential()
    return credential?.subject === subject ? credential : null
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
    revokeConsent(this.stored)
  }
}
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { acceptedMessage } from './meeting-upload-ack.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { deleteCloudCopy } from './meeting-upload-delete.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendDocument, sendRegistration } from './meeting-upload-transport.ts'
