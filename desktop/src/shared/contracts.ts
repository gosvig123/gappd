
export * from './generated/protocol'
export { RECORDING_STATUSES } from './meeting-recording-workflow'
export type { AIConfig, CaptureStatusInfo, Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem, MeetingSegment, MeetingStatus, ProcessingStatusInfo } from './generated/contracts'
export type { RecordingState, RecordingStatus } from './meeting-recording-workflow'
export type { ManagedRuntimeSnapshot, ManagedRuntimeOperation, ManagedRuntimeErrorDebug, ManagedRuntimeErrorKind, ManagedRuntimePullStage, OwnershipConflict } from './managed-runtime'

export const STABLE_UPDATE_CHANNEL = 'stable'
export const BETA_UPDATE_CHANNEL = 'beta'
export const DEFAULT_UPDATE_CHANNEL = STABLE_UPDATE_CHANNEL
export const UPDATE_CHANNELS = [STABLE_UPDATE_CHANNEL, BETA_UPDATE_CHANNEL] as const
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

export function isUpdateChannel(value: string | undefined): value is UpdateChannel {
  return UPDATE_CHANNELS.some((channel) => channel === value)
}

export const UPDATE_PHASES = ['idle', 'checking', 'available', 'downloading', 'downloaded', 'installing', 'error'] as const
export type UpdatePhase = (typeof UPDATE_PHASES)[number]

export type UpdateStatus = {
  phase: UpdatePhase
  available: boolean
  currentVersion: string
  channel: UpdateChannel
  latestVersion?: string
  name?: string
  releaseUrl?: string
  progress?: number
  error?: string
}
