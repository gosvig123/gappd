import type { MeetingUploadStatus } from '../../shared/meeting-upload-contract'

export type MeetingUploadApi = {
  status(): Promise<MeetingUploadStatus>
  connect(enabled: boolean): Promise<MeetingUploadStatus>
  setConsent(subject: string, enabled: boolean): Promise<MeetingUploadStatus>
  enqueue(localId: string): Promise<MeetingUploadStatus>
  sync(): Promise<MeetingUploadStatus>
  setDeleteConsent(subject: string, enabled: boolean, localId: string): Promise<MeetingUploadStatus>
  deleteCopy(subject: string, localId: string): Promise<MeetingUploadStatus>
  setAccountDeleteConsent(subject: string, enabled: boolean): Promise<MeetingUploadStatus>
  deleteAll(): Promise<MeetingUploadStatus>
  allowUploads(): Promise<MeetingUploadStatus>
  setRevokeConsent(subject: string, enabled: boolean, clientId: string): Promise<MeetingUploadStatus>
  revokeClient(subject: string, clientId: string): Promise<MeetingUploadStatus>
  knownClients(): Promise<string[]>
}

const REFRESH_MS = 2000

/**
 * Owns the Settings panel state for cloud Meeting upload. Work in the main process changes
 * on its own, so the panel polls while it is open and discards every result a newer action
 * or a closed panel has already invalidated.
 */
export class MeetingUploadPanelState {
  private generation = 0
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly api: MeetingUploadApi
  private readonly publish: (status: MeetingUploadStatus | null, error: string) => void

  constructor(api: MeetingUploadApi, publish: (status: MeetingUploadStatus | null, error: string) => void) {
    this.api = api
    this.publish = publish
  }

  async refresh(): Promise<void> {
    const id = this.generation
    if (this.disposed || id !== this.generation) return
    try {
      this.show(id, await this.api.status())
    } catch {
      if (!this.disposed && id === this.generation) this.publish(null, 'Cloud Meeting upload status is unavailable. Reopen Settings to check it.')
    }
    this.schedule()
  }

  async run(action: (api: MeetingUploadApi) => Promise<MeetingUploadStatus>): Promise<void> {
    if (this.disposed) return
    clearTimeout(this.timer)
    const id = ++this.generation
    try {
      this.show(id, await action(this.api))
    } catch {
      if (!this.disposed && id === this.generation) this.publish(null, 'That cloud Meeting action failed. Check the status before trying again.')
    }
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    clearTimeout(this.timer)
  }

  private show(id: number, value: MeetingUploadStatus): void {
    if (this.disposed || id !== this.generation) return
    this.publish(value, '')
  }

  private schedule(): void {
    if (this.disposed) return
    clearTimeout(this.timer)
    const id = this.generation
    this.timer = setTimeout(() => { if (!this.disposed && id === this.generation) void this.refresh() }, REFRESH_MS)
  }
}
