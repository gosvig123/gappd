import type { Device, LocalAIStatus, MeetingDeleteResponse, MeetingDetail, MeetingListItem, OnboardingStatus, RecordingState, UpdateStatus } from './contracts'
export type { OnboardingStatus, RecordingState, UpdateStatus } from './contracts'

export const IPC_CHANNELS = {
  system: {
    getDevices: 'system:getDevices',
    requestCapturePermissions: 'system:requestCapturePermissions',
    openPermissionsSettings: 'system:openPermissionsSettings',
    startStaleRecordingRecovery: 'system:startStaleRecordingRecovery',
  },
  meetings: {
    list: 'meetings:list',
    show: 'meetings:show',
    delete: 'meetings:delete',
  },
  recording: {
    start: 'recording:start',
    stop: 'recording:stop',
    getStatus: 'recording:getStatus',
  },
  onboarding: {
    getStatus: 'onboarding:getStatus',
    start: 'onboarding:start',
    retry: 'onboarding:retry',
  },
  settings: {
    getLocalAIStatus: 'settings:getLocalAIStatus',
    repairLocalAI: 'settings:repairLocalAI',
  },
  update: {
    getStatus: 'update:getStatus',
    checkNow: 'update:checkNow',
    downloadUpdate: 'update:downloadUpdate',
    installAndRestart: 'update:installAndRestart',
    openUpdatePage: 'update:openUpdatePage',
  },
} as const

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
} as const

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissionDetails = Record<string, string>
export type CapturePermissions = { microphone: string; screen: string; details?: CapturePermissionDetails }
export type StartRecordingInput = { title: string; device: number; mode: string; modelPath?: string }
export type OnboardingSetupInput = { model?: string }

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
