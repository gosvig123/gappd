import type { AIConfig } from './generated/contracts'

export * from './generated/protocol'
export type { AIConfig, CaptureStatusInfo, Device, MeetingDetail, MeetingListItem, MeetingSegment, MeetingStatus, ProcessingStatusInfo } from './generated/contracts'

export type LocalAIConfig = AIConfig

// Desktop-only UI state for the recorder; not part of the gappd wire protocol.
export const RECORDING_STATUSES = ['idle', 'recording', 'stopping', 'processing', 'error'] as const
export type RecordingStatus = (typeof RECORDING_STATUSES)[number]

export type RecordingState = {
  status: RecordingStatus
  meetingId?: string
  title?: string
  error?: string
}

export function isLocalAIConfigured(config: LocalAIConfig | null | undefined): boolean {
  return Boolean(config?.provider && config.endpoint && config.model)
}

export function isManagedLocalAIConfigured(config: LocalAIConfig | null | undefined): boolean {
  return Boolean(config?.managed && isLocalAIConfigured(config))
}

export type OnboardingPhase =
  | 'checking'
  | 'needs_setup'
  | 'starting_ollama'
  | 'pulling_model'
  | 'saving_config'
  | 'ready'
  | 'error'

export type OnboardingPullStage = 'preparing' | 'downloading' | 'verifying' | 'finalizing' | 'complete'

export type OnboardingErrorKind = 'pull_timeout' | 'pull_network' | 'pull_blob_host_network' | 'disk_space' | 'permission' | 'ownership_mismatch' | 'runtime'

export type OnboardingErrorDebug = {
  rawDetail?: string
  url?: string
  host?: string
  ip?: string
}

export type OwnershipConflict = {
  pid: number
  port: number
  summary?: string
  stopCommand?: string
}

export type OnboardingStatus = {
  phase: OnboardingPhase
  managed: boolean
  endpoint: string
  model: string
  message: string
  progress?: number
  error?: string
  errorDetail?: string
  debugDetail?: string
  errorDebug?: OnboardingErrorDebug
  pullStage?: OnboardingPullStage
  errorKind?: OnboardingErrorKind
  ownershipConflict?: OwnershipConflict
  canRetry: boolean
}

export type LocalAIStatus = OnboardingStatus & {
  supported: boolean
  configured: boolean
  bundled: boolean
  running: boolean
  canRepair: boolean
}

export type UpdateStatus =
  | { available: false; currentVersion: string; latestVersion?: string }
  | {
    available: true
    currentVersion: string
    latestVersion: string
    releaseUrl: string
    downloadUrl?: string
    sha256?: string
    channel?: string
    name?: string
  }

export type UpdateDownloadResult = {
  filePath: string
  fileName: string
}
