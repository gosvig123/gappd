import type { Device, LocalAIStatus, MeetingDeleteResponse, MeetingDetail, MeetingListItem, OnboardingStatus, RecordingState, UpdateStatus } from './contracts'
export type { OnboardingStatus, RecordingState, UpdateStatus } from './contracts'

export const IPC_OPERATIONS = [
  { group: 'system', name: 'getDevices', channel: 'system:getDevices' },
  { group: 'system', name: 'requestCapturePermissions', channel: 'system:requestCapturePermissions' },
  { group: 'system', name: 'openPermissionsSettings', channel: 'system:openPermissionsSettings' },
  { group: 'system', name: 'startStaleRecordingRecovery', channel: 'system:startStaleRecordingRecovery' },
  { group: 'meetings', name: 'list', channel: 'meetings:list' },
  { group: 'meetings', name: 'show', channel: 'meetings:show' },
  { group: 'meetings', name: 'delete', channel: 'meetings:delete' },
  { group: 'recording', name: 'start', channel: 'recording:start' },
  { group: 'recording', name: 'stop', channel: 'recording:stop' },
  { group: 'recording', name: 'getStatus', channel: 'recording:getStatus' },
  { group: 'onboarding', name: 'getStatus', channel: 'onboarding:getStatus' },
  { group: 'onboarding', name: 'start', channel: 'onboarding:start' },
  { group: 'onboarding', name: 'retry', channel: 'onboarding:retry' },
  { group: 'settings', name: 'getLocalAIStatus', channel: 'settings:getLocalAIStatus' },
  { group: 'settings', name: 'repairLocalAI', channel: 'settings:repairLocalAI' },
  { group: 'settings', name: 'getTranscriptionSettings', channel: 'settings:getTranscriptionSettings' },
  { group: 'settings', name: 'downloadWhisperModel', channel: 'settings:downloadWhisperModel' },
  { group: 'settings', name: 'setDefaultWhisperModel', channel: 'settings:setDefaultWhisperModel' },
  { group: 'update', name: 'getStatus', channel: 'update:getStatus' },
  { group: 'update', name: 'checkNow', channel: 'update:checkNow' },
  { group: 'update', name: 'downloadUpdate', channel: 'update:downloadUpdate' },
  { group: 'update', name: 'installAndRestart', channel: 'update:installAndRestart' },
  { group: 'update', name: 'openUpdatePage', channel: 'update:openUpdatePage' },
] as const

export type IpcOperation = typeof IPC_OPERATIONS[number]
export type IpcOperationChannel = IpcOperation['channel']

export const IPC_EVENTS = {
  recording: {
    statusChanged: 'recording:status-changed',
  },
  onboarding: {
    statusChanged: 'onboarding:status-changed',
  },
  update: {
    statusChanged: 'update:status-changed',
  },
  settings: {
    whisperModelDownloadProgress: 'settings:whisper-model-download-progress',
  },
} as const

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissionDetails = Record<string, string>
export type CapturePermissions = { microphone: string; screen: string; details?: CapturePermissionDetails }
export type StartRecordingInput = { title: string; device: number; mode: string; modelPath?: string }
export type OnboardingSetupInput = { model?: string }
export type WhisperModelSettings = {
  id: string
  name: string
  label: string
  languageSupport: string
  description: string
  sizeMB: number
  installed: boolean
}
export type TranscriptionSettings = { defaultModelId: string; models: WhisperModelSettings[] }
export type WhisperModelDownloadProgress = {
  modelId: string
  phase: 'preparing' | 'downloading' | 'verifying' | 'complete'
  progress?: number
  message: string
}

export type GappdApi = {
  system: {
    getDevices(): Promise<Device[]>
    requestCapturePermissions(): Promise<CapturePermissions>
    openPermissionsSettings(target?: CapturePermissionTarget): Promise<void>
    startStaleRecordingRecovery(): Promise<number>
  }
  meetings: {
    list(): Promise<MeetingListItem[]>
    show(id: string): Promise<MeetingDetail>
    delete(id: string): Promise<MeetingDeleteResponse>
  }
  recording: {
    start(input: StartRecordingInput): Promise<RecordingState>
    stop(): Promise<RecordingState>
    getStatus(): Promise<RecordingState>
    onStatusChanged(listener: (state: RecordingState) => void): () => void
  }
  onboarding: {
    getStatus(): Promise<OnboardingStatus>
    start(input?: OnboardingSetupInput): Promise<OnboardingStatus>
    retry(input?: OnboardingSetupInput): Promise<OnboardingStatus>
    onStatusChanged(listener: (state: OnboardingStatus) => void): () => void
  }
  settings: {
    getLocalAIStatus(): Promise<LocalAIStatus>
    repairLocalAI(): Promise<LocalAIStatus>
    getTranscriptionSettings(): Promise<TranscriptionSettings>
    downloadWhisperModel(id: string): Promise<TranscriptionSettings>
    setDefaultWhisperModel(id: string): Promise<TranscriptionSettings>
    onWhisperModelDownloadProgress(listener: (progress: WhisperModelDownloadProgress) => void): () => void
  }
  update: {
    getStatus(): Promise<UpdateStatus>
    checkNow(): Promise<UpdateStatus>
    downloadUpdate(): Promise<UpdateStatus>
    installAndRestart(): Promise<UpdateStatus>
    openUpdatePage(): Promise<void>
    onStatusChanged(listener: (state: UpdateStatus) => void): () => void
  }
}
