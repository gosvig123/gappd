export const RECORDING_STATUSES = ['idle', 'recording', 'stopping', 'processing', 'error'] as const
export type RecordingStatus = (typeof RECORDING_STATUSES)[number]

export type RecordingState = {
  status: RecordingStatus
  meetingId?: string
  title?: string
  error?: string
}

export type Device = {
  index: number
  name: string
}

export const CAPTURE_STATUSES = ['recording', 'captured', 'failed'] as const
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number]

export const PROCESSING_STATUSES = ['not_started', 'processing', 'completed', 'failed'] as const
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number]

export const MEETING_STATES = ['recording', 'captured', 'processing', 'completed', 'failed'] as const
export type MeetingState = (typeof MEETING_STATES)[number]

export const RECORDING_PROTOCOL_EVENT_TYPES = [
  'recording.started',
  'recording.stopping',
  'recording.processing',
  'recording.completed',
  'recording.failed',
] as const
export type RecordingProtocolEventType = (typeof RECORDING_PROTOCOL_EVENT_TYPES)[number]

export type MeetingStatus = {
  state: MeetingState
  updatedAt: string
  capture: {
    state: CaptureStatus
    updatedAt: string
    failureMessage?: string
  }
  processing: {
    state: ProcessingStatus
    updatedAt: string
    failureMessage?: string
  }
}

export type MeetingListItem = {
  id: string
  title: string
  startedAt: string
  endedAt?: string
  status: MeetingStatus
  hasTranscript: boolean
  hasSummary: boolean
}

export type MeetingSegment = {
  startSec: number
  endSec: number
  speaker: string
  text: string
}

export type MeetingDetail = {
  id: string
  title: string
  startedAt: string
  endedAt?: string
  status: MeetingStatus
  transcriptText?: string
  summary?: string
  segments: MeetingSegment[]
}

export type LocalAIConfig = {
  provider: string
  temperature: number
  managed: boolean
  endpoint: string
  model: string
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
