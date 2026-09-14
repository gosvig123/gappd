import type { MeetingUploadStatus } from '../shared/meeting-upload-contract'
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
    await syncUploads(this.context())
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

  /** Cuts one client's access to this account. Stored copies are not touched. */
  async revokeClient(subject: unknown, clientId: unknown): Promise<MeetingUploadStatus> {
    const held = this.stored.revocation
    if (!this.writable() || typeof subject !== 'string' || typeof clientId !== 'string') throw new Error('Revocation unavailable.')
    if (!held || held.subject !== subject || held.clientId !== clientId) return this.status()
    this.stored.revocation = null
    await revokeClientAccess(this.context(), subject, clientId)
    return this.status()
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
    return this.available && !this.pending
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
import { allowUploadsAgain, deleteAllCloudData, revokeClientAccess } from './meeting-upload-actions.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { deleteCloudCopy } from './meeting-upload-delete.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { syncUploads } from './meeting-upload-sync.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import type { UploadContext } from './meeting-upload-context.ts'
