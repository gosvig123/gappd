import type { DemoUploadStatus } from '../shared/demo-upload-contract'
import type { CloudAuth, CloudCredential } from './cloud-auth'

type Authorization = Pick<CloudAuth, 'status' | 'setEnabled' | 'credential'> & Partial<Pick<CloudAuth, 'observeAuthorization'>>
type Consent = { subject: string; token: string; action: 'create' | 'delete' }

/** Manual synthetic transport only. No local Meeting storage is referenced. */
export class DemoUpload {
  private auth: Authorization
  private resource: string
  private available: boolean
  private fetcher: typeof fetch
  private generation = 0
  private consent: Consent | null = null
  private pending: AbortController | null = null
  private result: string | null = null

  constructor(auth: Authorization, resource: string, available: boolean, fetcher: typeof fetch = fetch) {
    this.auth = auth
    this.resource = resource
    this.available = available
    this.fetcher = fetcher
    auth.observeAuthorization?.(() => this.invalidate())
  }

  async status(): Promise<DemoUploadStatus> {
    const account = await this.auth.status()
    if (!account.enabled || account.subject !== this.consent?.subject) this.consent = null
    return { available: this.available, account, consent: this.consent?.action === 'create', deleteConsent: this.consent?.action === 'delete', sending: Boolean(this.pending), result: this.result }
  }

  async connect(enabled: unknown): Promise<DemoUploadStatus> {
    if (typeof enabled !== 'boolean') throw new Error('Boolean required.')
    if (enabled && !this.available) throw new Error('Synthetic demo is disabled.')
    this.invalidate()
    await this.auth.setEnabled(enabled)
    return this.status()
  }

  async setConsent(subject: unknown, enabled: unknown): Promise<DemoUploadStatus> {
    return this.setActionConsent(subject, enabled, 'create')
  }

  async setDeleteConsent(subject: unknown, enabled: unknown): Promise<DemoUploadStatus> {
    return this.setActionConsent(subject, enabled, 'delete')
  }

  private async setActionConsent(subject: unknown, enabled: unknown, action: 'create' | 'delete'): Promise<DemoUploadStatus> {
    if (typeof enabled !== 'boolean' || typeof subject !== 'string') throw new Error('Invalid consent.')
    this.invalidate()
    const generation = this.generation
    const credential = await this.auth.credential()
    if (enabled && this.available && credential?.subject === subject && generation === this.generation) {
      this.consent = { subject, token: credential.tokens.accessToken, action }
    }
    return this.status()
  }

  async upload(subject: unknown): Promise<DemoUploadStatus> {
    return this.perform(subject, 'create')
  }

  async deleteCopy(subject: unknown): Promise<DemoUploadStatus> {
    return this.perform(subject, 'delete')
  }

  private async perform(subject: unknown, action: 'create' | 'delete'): Promise<DemoUploadStatus> {
    if (!this.available || this.pending || typeof subject !== 'string') throw new Error('Demo unavailable.')
    const consent = this.consent
    this.consent = null
    const generation = ++this.generation
    const credential = await this.auth.credential()
    if (generation !== this.generation || !matches(consent, credential, subject) || consent?.action !== action) return this.status()
    const controller = new AbortController()
    this.pending = controller
    this.result = `Sending synthetic demo ${action}. Cancellation cannot recall an accepted request.`
    await this.send(credential!, controller, generation, action)
    return this.status()
  }

  private async send(credential: CloudCredential, controller: AbortController, generation: number, action: 'create' | 'delete'): Promise<void> {
    try {
      const response = await this.fetcher(new URL('/demo-meeting', this.resource), {
        method: action === 'delete' ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${credential.tokens.accessToken}` },
        redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      const value = await response.json()
      if (!response.ok || !acknowledged(value, credential.subject, action)) throw new Error('No acknowledgment.')
      const current = await this.auth.credential()
      if (generation !== this.generation) return
      if (!current || current.subject !== credential.subject || current.tokens.accessToken !== credential.tokens.accessToken) throw new Error('Account changed.')
      this.result = action === 'delete'
        ? `Deleted the synthetic cloud copy for ${credential.email} (${credential.subject}). Local Meetings and audio are unchanged. This demo ID cannot be created again. The approved 7-day backup limit is not yet configured or verified.`
        : `Accepted synthetic demo Meeting: ${value.id} for ${credential.email} (${credential.subject}). Expires at ${value.expires_at}. Cloud copies remain after OFF.`
    } catch {
      if (generation === this.generation) this.result = `No acknowledgment. The server may have accepted the demo ${action}. No automatic retry; check the account and confirm again before retrying.`
    } finally {
      if (generation === this.generation) this.pending = null
    }
  }

  private invalidate(): void {
    this.generation++
    this.consent = null
    if (this.pending) this.result = 'Cancelled locally. The server may already have accepted the request; OFF does not request deletion.'
    this.pending?.abort()
    this.pending = null
  }
}

function matches(consent: Consent | null, credential: CloudCredential | null, subject: string): boolean {
  return Boolean(consent && credential && consent.subject === subject && credential.subject === subject && consent.token === credential.tokens.accessToken)
}

function acknowledged(value: unknown, subject: string, action: 'create' | 'delete'): value is { id: string; expires_at: string } {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  if (action === 'delete') return result.status === 'deleted' && result.subject === subject
  return typeof result.expires_at === 'string' && Number.isFinite(Date.parse(result.expires_at)) && result.status === 'accepted' && result.subject === subject && typeof result.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.id)
}
