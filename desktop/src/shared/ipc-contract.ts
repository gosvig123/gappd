import type { Device, LocalAIStatus, MeetingDetail, MeetingListItem, OnboardingStatus, RecordingState } from './contracts'
export type { OnboardingStatus, RecordingState } from './contracts'

export const IPC_CHANNELS = {
  system: {
    getDevices: 'system:getDevices',
    requestCapturePermissions: 'system:requestCapturePermissions',
    openPermissionsSettings: 'system:openPermissionsSettings',
  },
  meetings: {
    list: 'meetings:list',
    show: 'meetings:show',
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
} as const

export const IPC_EVENTS = {
  recording: {
    statusChanged: 'recording:status-changed',
  },
  onboarding: {
    statusChanged: 'onboarding:status-changed',
  },
} as const

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissions = { microphone: string; screen: string }
export type StartRecordingInput = { title: string; device: number; mode: string; modelPath?: string }

export type GappdApi = {
  system: {
    getDevices(): Promise<Device[]>
    requestCapturePermissions(): Promise<CapturePermissions>
    openPermissionsSettings(target?: CapturePermissionTarget): Promise<void>
  }
  meetings: {
    list(): Promise<MeetingListItem[]>
    show(id: string): Promise<MeetingDetail>
  }
  recording: {
    start(input: StartRecordingInput): Promise<RecordingState>
    stop(): Promise<RecordingState>
    getStatus(): Promise<RecordingState>
    onStatusChanged(listener: (state: RecordingState) => void): () => void
  }
  onboarding: {
    getStatus(): Promise<OnboardingStatus>
    start(): Promise<OnboardingStatus>
    retry(): Promise<OnboardingStatus>
    onStatusChanged(listener: (state: OnboardingStatus) => void): () => void
  }
  settings: {
    getLocalAIStatus(): Promise<LocalAIStatus>
    repairLocalAI(): Promise<LocalAIStatus>
  }
}
