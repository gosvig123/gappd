import type { CloudAuthStatus } from '../../shared/cloud-auth-contract'

type CloudAuthApi = { status(): Promise<CloudAuthStatus>; setEnabled(enabled: boolean): Promise<CloudAuthStatus> }
const MAX_PENDING_READS = 360
const REFRESH_MS = 1000

/** Poll only pending sign-in; a closed panel or newer action invalidates every older result. */
export class CloudAuthPanelState {
  private generation = 0
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private pendingReads = 0
  private api: CloudAuthApi
  private publish: (status: CloudAuthStatus) => void

  constructor(api: CloudAuthApi, publish: (status: CloudAuthStatus) => void) {
    this.api = api; this.publish = publish
  }

  async refresh(id = this.generation): Promise<void> {
    if (!this.current(id)) return
    try { this.show(id, await this.api.status()) }
    catch { if (this.current(id)) this.publish(failedStatus()) }
  }

  async update(enabled: boolean): Promise<void> {
    if (this.disposed) return
    clearTimeout(this.timer); this.pendingReads = 0
    const id = ++this.generation
    this.publish({ enabled: false, pending: enabled, email: null, subject: null, error: null })
    try { this.show(id, await this.api.setEnabled(enabled)) }
    catch { if (this.current(id)) this.publish(failedStatus()) }
  }

  dispose(): void { this.disposed = true; this.generation++; clearTimeout(this.timer) }

  private current(id: number): boolean { return !this.disposed && id === this.generation }

  private show(id: number, value: CloudAuthStatus): void {
    if (!this.current(id)) return
    this.publish(value)
    if (!value.pending) { this.pendingReads = 0; return }
    if (++this.pendingReads > MAX_PENDING_READS) { this.publish(failedStatus()); return }
    this.timer = setTimeout(() => { void this.refresh(id) }, REFRESH_MS)
  }
}

function failedStatus(): CloudAuthStatus {
  return { enabled: false, pending: false, email: null, subject: null, error: 'Cloud authentication status is unavailable. Reopen Settings to check sign-in, or choose Remove local credentials to cancel and clear it.' }
}
