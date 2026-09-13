import type { MeetingUploadStatus } from '../shared/meeting-upload-contract'
import type { MeetingSyncWork } from '../shared/meeting-sync-contract'
import type { CloudAuth, CloudCredential } from './cloud-auth'
import type { MeetingSyncQueue } from './meeting-sync-queue'

type Authorization = Pick<CloudAuth, 'status' | 'setEnabled' | 'credential'> & Partial<Pick<CloudAuth, 'observeAuthorization'>>

/** Consent is bound to the verified account and the exact token observed when it was given. */
type Consent = { subject: string; token: string }
type DeleteConsent = Consent & { localId: string }

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
  private readonly fetcher: typeof fetch
  private generation = 0
  private consent: Consent | null = null
  private deleteConsent: DeleteConsent | null = null
  private pending: AbortController | null = null
  private result: string | null = null

  constructor(auth: Authorization, resource: string, available: boolean, queue: MeetingSyncQueue,
    loadDocument: (localId: string, revision: number) => Promise<string>, fetcher: typeof fetch = fetch) {
    this.auth = auth
    this.resource = resource
    this.available = available
    this.queue = queue
    this.loadDocument = loadDocument
    this.fetcher = fetcher
    auth.observeAuthorization?.(() => this.revokeAll())
  }

  async status(): Promise<MeetingUploadStatus> {
    const account = await this.auth.status()
    if (!account.enabled) {
      this.clearConsent()
    } else {
      // An absent upload consent must not erase an unrelated deletion confirmation.
      if (this.consent && this.consent.subject !== account.subject) this.consent = null
      if (this.deleteConsent && this.deleteConsent.subject !== account.subject) this.deleteConsent = null
    }
    return {
      available: this.available, account, consent: Boolean(this.consent),
      deleteConsent: Boolean(this.deleteConsent), sending: Boolean(this.pending), result: this.result, queue: await this.queue.status(),
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
    this.consent = credential && { subject: credential.subject, token: credential.tokens.accessToken }
    return this.status()
  }

  /** Deletion is destructive, so it keeps its own one-use confirmation for one Meeting. */
  async setDeleteConsent(subject: unknown, enabled: unknown, localId: unknown): Promise<MeetingUploadStatus> {
    if (typeof localId !== 'string' || localId.length === 0) throw new Error('Invalid consent.')
    const credential = await this.verified(subject, enabled)
    this.deleteConsent = credential && { subject: credential.subject, token: credential.tokens.accessToken, localId }
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
    const consent = this.deleteConsent
    // A confirmation for another Meeting, or for another account, is not consumed by this call.
    if (!consent || consent.subject !== subject || consent.localId !== localId) return this.status()
    const credential = await this.consented()
    if (!credential || credential.subject !== subject) return this.status()
    this.deleteConsent = null
    const controller = new AbortController()
    this.pending = controller
    this.result = 'Deleting the cloud copy. Cancellation cannot recall an accepted request.'
    await this.sendDelete(credential, controller, localId)
    return this.status()
  }

  private async drain(credential: CloudCredential, controller: AbortController, generation: number): Promise<void> {
    for (let sent = 0; sent < MAX_SENDS_PER_SYNC; sent++) {
      const work = await this.queue.pending()
      if (!work || generation !== this.generation) return
      if (!await this.sendOne(credential, controller, work)) return
    }
  }

  private async sendOne(credential: CloudCredential, controller: AbortController, work: MeetingSyncWork): Promise<boolean> {
    const outcome = await sendDocument(this.fetcher, this.resource, credential, work, controller.signal)
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

  private async sendDelete(credential: CloudCredential, controller: AbortController, localId: string): Promise<void> {
    const deleted = await sendDelete(this.fetcher, this.resource, credential, localId, controller.signal)
    this.pending = null
    this.result = deleted
      ? `Deleted the cloud copy for ${credential.email} (${credential.subject}). The local Meeting and its audio are unchanged. This identity cannot be uploaded again, and backup removal can take up to 7 days.`
      : 'No acknowledgment. The server may have deleted the copy. Nothing was retried; confirm the account and try again.'
  }

  private async verified(subject: unknown, enabled: unknown): Promise<CloudCredential | null> {
    if (typeof enabled !== 'boolean' || typeof subject !== 'string') throw new Error('Invalid consent.')
    this.cancelPending()
    if (!enabled || !this.available) return null
    const credential = await this.auth.credential()
    return credential?.subject === subject ? credential : null
  }

  private async consented(): Promise<CloudCredential | null> {
    const account = await this.auth.status()
    if (!account.enabled || !this.consent || this.consent.subject !== account.subject) return null
    const credential = await this.auth.credential()
    if (!credential || credential.subject !== this.consent.subject || credential.tokens.accessToken !== this.consent.token) return null
    return credential
  }

  private clearConsent(): void {
    this.consent = null
    this.deleteConsent = null
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
    this.clearConsent()
  }
}
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { acceptedMessage } from './meeting-upload-ack.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendDelete, sendDocument } from './meeting-upload-transport.ts'
