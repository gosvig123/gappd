import type { CloudAuth, CloudCredential } from './cloud-auth'
import type { SelectedFixtureStatus } from '../shared/selected-fixture-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SELECTED_FIXTURE_BYTES, SELECTED_FIXTURE_ID } from '../shared/selected-fixture-contract.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { sendSelectedFixture } from './selected-fixture-send.ts'

type Authorization = Pick<CloudAuth, 'status' | 'credential' | 'setEnabled' | 'authorizationGeneration' | 'observeAuthorization' | 'invalidateAuthorization'>
type Consent = { credential: CloudCredential; authorization: number; bytes: string; action: 'upload' | 'delete' }

export class SelectedFixtureUpload {
  private auth: Authorization
  private read: (id: string) => Promise<string>
  private available: boolean
  private fetcher: typeof fetch
  private resource: string
  private generation = 0
  private previewBytes: string | null = null
  private consent: Consent | null = null
  private pending: AbortController | null = null
  private result: string | null = null

  constructor(auth: Authorization, read: (id: string) => Promise<string>, available: boolean, resource: string, fetcher = fetch) {
    this.auth = auth
    this.read = read
    this.available = available
    this.resource = resource
    this.fetcher = fetcher
    auth.observeAuthorization(() => this.invalidate())
  }

  async status(): Promise<SelectedFixtureStatus> {
    const credential = await this.auth.credential()
    if (this.consent && !this.matches(this.consent, credential)) this.cancel()
    return { available: this.available, account: await this.auth.status(), preview: this.previewBytes, consent: this.consent?.action === 'upload', deleteConsent: this.consent?.action === 'delete', sending: Boolean(this.pending), result: this.result }
  }

  async connect(enabled: boolean): Promise<SelectedFixtureStatus> {
    if (typeof enabled !== 'boolean' || (enabled && !this.available)) throw new Error('Fixture disabled.')
    this.cancel()
    await this.auth.setEnabled(enabled)
    return this.status()
  }

  cancel(): void { this.auth.invalidateAuthorization() }

  private invalidate(): void {
    this.generation++
    this.consent = null
    this.previewBytes = null
    if (this.pending) this.result = 'Cancelled locally. The server may already have accepted the request. No automatic retry.'
    this.pending?.abort()
    this.pending = null
  }

  async preview(id: unknown): Promise<SelectedFixtureStatus> {
    this.cancel()
    const generation = this.generation
    if (!this.available || id !== SELECTED_FIXTURE_ID) throw new Error('Selected fixture required.')
    const bytes = await this.read(id)
    if (bytes !== SELECTED_FIXTURE_BYTES) throw new Error('Selected fixture changed.')
    if (generation === this.generation) this.previewBytes = bytes
    return this.status()
  }

  async setConsent(subject: unknown, enabled: unknown, action: 'upload' | 'delete'): Promise<SelectedFixtureStatus> {
    if (this.pending) throw new Error('Consent unavailable.')
    this.consent = null
    const generation = ++this.generation
    const authorization = this.auth.authorizationGeneration()
    if (!this.available || typeof enabled !== 'boolean' || !['upload', 'delete'].includes(action)) throw new Error('Consent unavailable.')
    const credential = await this.auth.credential()
    if (enabled && credential && credential.subject === subject && this.previewBytes && generation === this.generation && authorization === this.auth.authorizationGeneration()) {
      this.consent = { credential: structuredClone(credential), authorization, bytes: this.previewBytes, action }
    }
    return this.status()
  }

  async perform(subject: unknown, action: 'upload' | 'delete'): Promise<SelectedFixtureStatus> {
    const consent = this.consent
    this.consent = null
    if (!this.available || this.pending || !consent || consent.action !== action || consent.credential.subject !== subject) return this.status()
    const generation = ++this.generation
    const bytes = await this.read(SELECTED_FIXTURE_ID).catch(() => null)
    const credential = await this.auth.credential()
    if (generation !== this.generation || bytes !== consent.bytes || bytes !== SELECTED_FIXTURE_BYTES || !this.matches(consent, credential)) {
      if (generation === this.generation) this.cancel()
      return this.status()
    }
    const controller = new AbortController()
    this.pending = controller
    this.result = 'Sending. Cancellation cannot recall server acceptance.'
    const result = await sendSelectedFixture(this.fetcher, this.resource, consent.credential, consent.bytes, action, controller.signal)
    if (generation === this.generation) {
      this.pending = null
      this.result = result
    }
    return this.status()
  }

  private matches(consent: Consent, credential: CloudCredential | null): boolean {
    return Boolean(credential && consent.authorization === this.auth.authorizationGeneration() && consent.credential.subject === credential.subject && consent.credential.email === credential.email && consent.credential.tokens.accessToken === credential.tokens.accessToken && credential.tokens.expiresAt > Date.now() + 60_000)
  }
}
