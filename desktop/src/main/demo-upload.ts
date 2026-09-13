import type { DemoUploadStatus } from '../shared/demo-upload-contract'
import type { CloudAuth, CloudCredential } from './cloud-auth'

type Authorization = Pick<CloudAuth, 'status' | 'setEnabled' | 'credential'>
type Consent = { subject: string; token: string }

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
  }

  async status(): Promise<DemoUploadStatus> {
    const account = await this.auth.status()
    if (!account.enabled || account.subject !== this.consent?.subject) this.consent = null
    return { available: this.available, account, consent: Boolean(this.consent), sending: Boolean(this.pending), result: this.result }
  }

  async connect(enabled: unknown): Promise<DemoUploadStatus> {
    if (typeof enabled !== 'boolean') throw new Error('Boolean required.')
    if (enabled && !this.available) throw new Error('Synthetic demo is disabled.')
    this.invalidate()
    await this.auth.setEnabled(enabled)
    return this.status()
  }

  async setConsent(subject: unknown, enabled: unknown): Promise<DemoUploadStatus> {
    if (typeof enabled !== 'boolean' || typeof subject !== 'string') throw new Error('Invalid consent.')
    this.invalidate()
    const generation = this.generation
    const credential = await this.auth.credential()
    if (enabled && this.available && credential?.subject === subject && generation === this.generation) {
      this.consent = { subject, token: credential.tokens.accessToken }
    }
    return this.status()
  }

  async upload(subject: unknown): Promise<DemoUploadStatus> {
    if (!this.available || this.pending || typeof subject !== 'string') throw new Error('Demo unavailable.')
    const consent = this.consent
    this.consent = null
    const generation = ++this.generation
    const credential = await this.auth.credential()
    if (generation !== this.generation || !matches(consent, credential, subject)) return this.status()
    const controller = new AbortController()
    this.pending = controller
    this.result = 'Sending synthetic demo. Cancellation cannot recall an accepted request.'
    await this.send(credential!, controller, generation)
    return this.status()
  }

  private async send(credential: CloudCredential, controller: AbortController, generation: number): Promise<void> {
    try {
      const response = await this.fetcher(new URL('/demo-meeting', this.resource), {
        method: 'POST', headers: { Authorization: `Bearer ${credential.tokens.accessToken}` },
        redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      const value = await response.json()
      if (!response.ok || !acknowledged(value, credential.subject)) throw new Error('No acknowledgment.')
      if (generation === this.generation) this.result = `Accepted synthetic demo Meeting: ${value.id}. Cloud copies remain after OFF.`
    } catch {
      if (generation === this.generation) this.result = 'No acknowledgment. The server may have accepted the demo. No automatic retry.'
    } finally {
      if (generation === this.generation) this.pending = null
    }
  }

  private invalidate(): void {
    this.generation++
    this.consent = null
    if (this.pending) this.result = 'Cancelled locally. The server may already have accepted the demo; OFF does not delete it.'
    this.pending?.abort()
    this.pending = null
  }
}

function matches(consent: Consent | null, credential: CloudCredential | null, subject: string): boolean {
  return Boolean(consent && credential && consent.subject === subject && credential.subject === subject && consent.token === credential.tokens.accessToken)
}

function acknowledged(value: unknown, subject: string): value is { id: string } {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return result.status === 'accepted' && result.subject === subject && typeof result.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.id)
}
