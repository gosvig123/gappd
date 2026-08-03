import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem, RecordingState, UpdateStatus } from './contracts'
import type { ManagedRuntimePrepareMode, ManagedRuntimeSnapshot } from './managed-runtime'
export type { ManagedRuntimeSnapshot, RecordingState, UpdateStatus } from './contracts'

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissionDetails = Record<string, string>
export type CapturePermissions = { microphone: string; screen: string; details?: CapturePermissionDetails }
export type StartRecordingInput = { title?: string; device?: number; mode?: string; language?: string; speakerLabelsEnabled?: boolean }
export type ManagedRuntimePrepareInput = { mode: ManagedRuntimePrepareMode; model?: string }
export type StartupSettings = { openAtLogin: boolean; supported: boolean; requiresApproval: boolean; speakerLabelsEnabled: boolean }
export type PiAuthType = 'api_key' | 'oauth'
export type PiModelOption = { provider: string; providerName: string; id: string; name: string; authTypes: PiAuthType[] }
export type AIProviderStatus = { selected: boolean; configured: boolean; provider: string; model: string; models: PiModelOption[]; authType?: PiAuthType; error?: string }
export type PiConfigurationInput = { provider: string; model: string; apiKey?: string }
export type PiAuthPrompt = { id: string; type: 'text' | 'secret' | 'select' | 'manual_code'; message: string; placeholder?: string; options?: readonly { id: string; label: string; description?: string }[] }
export type PiAuthEvent = { type: 'prompt'; prompt: PiAuthPrompt } | { type: 'notice'; message: string; url?: string; userCode?: string }
export type PiAuthAnswer = { id: string; value?: string; cancelled?: boolean }

type OperationSpec<Args extends unknown[], Result> = { args: Args; result: Result }

export type IpcInvokeContract = {
  system: {
    getDevices: OperationSpec<[], Device[]>
    requestCapturePermissions: OperationSpec<[], CapturePermissions>
    openPermissionsSettings: OperationSpec<[target?: CapturePermissionTarget], void>
    startStaleRecordingRecovery: OperationSpec<[], number>
  }
  meetings: {
    list: OperationSpec<[], MeetingListItem[]>
    show: OperationSpec<[id: string], MeetingDetail>
    retryDiarization: OperationSpec<[id: string], MeetingDetail>
    delete: OperationSpec<[id: string], MeetingDeleteResponse>
  }
  recording: {
    start: OperationSpec<[input: StartRecordingInput], RecordingState>
    stop: OperationSpec<[], RecordingState>
    getStatus: OperationSpec<[], RecordingState>
  }
  managedRuntime: {
    status: OperationSpec<[], ManagedRuntimeSnapshot>
    prepare: OperationSpec<[input: ManagedRuntimePrepareInput], ManagedRuntimeSnapshot>
  }
  aiProvider: {
    status: OperationSpec<[], AIProviderStatus>
    configurePi: OperationSpec<[input: PiConfigurationInput], AIProviderStatus>
    configurePiOAuth: OperationSpec<[input: PiConfigurationInput], AIProviderStatus>
    answerPiAuth: OperationSpec<[answer: PiAuthAnswer], void>
    cancelPiAuth: OperationSpec<[], void>
    useLocal: OperationSpec<[], AIProviderStatus>
    clearPiCredential: OperationSpec<[provider: string], AIProviderStatus>
  }
  update: {
    getStatus: OperationSpec<[], UpdateStatus>
    checkNow: OperationSpec<[], UpdateStatus>
    downloadUpdate: OperationSpec<[], UpdateStatus>
    installAndRestart: OperationSpec<[], UpdateStatus>
    openUpdatePage: OperationSpec<[], void>
  }
  startup: {
    getSettings: OperationSpec<[], StartupSettings>
    setOpenAtLogin: OperationSpec<[openAtLogin: boolean], StartupSettings>
    setSpeakerLabelsEnabled: OperationSpec<[enabled: boolean], StartupSettings>
  }
}

export type IpcOperationGroup = Extract<keyof IpcInvokeContract, string>
export type IpcOperationName<G extends IpcOperationGroup> = Extract<keyof IpcInvokeContract[G], string>
export type IpcOperationArgs<G extends IpcOperationGroup, N extends IpcOperationName<G>> = IpcInvokeContract[G][N] extends { args: infer Args extends unknown[] } ? Args : never
export type IpcOperationResult<G extends IpcOperationGroup, N extends IpcOperationName<G>> = IpcInvokeContract[G][N] extends { result: infer Result } ? Result : never
export type IpcInvokeApi = { [G in IpcOperationGroup]: { [N in IpcOperationName<G>]: (...args: IpcOperationArgs<G, N>) => Promise<IpcOperationResult<G, N>> } }

type IpcOperationChannels = { [G in IpcOperationGroup]: { [N in IpcOperationName<G>]: `${G}:${string}` } }

export const IPC_OPERATIONS = {
  system: {
    getDevices: 'system:getDevices',
    requestCapturePermissions: 'system:requestCapturePermissions',
    openPermissionsSettings: 'system:openPermissionsSettings',
    startStaleRecordingRecovery: 'system:startStaleRecordingRecovery',
  },
  meetings: { list: 'meetings:list', show: 'meetings:show', retryDiarization: 'meetings:retryDiarization', delete: 'meetings:delete' },
  recording: { start: 'recording:start', stop: 'recording:stop', getStatus: 'recording:getStatus' },
  managedRuntime: { status: 'managedRuntime:status', prepare: 'managedRuntime:prepare' },
  aiProvider: { status: 'aiProvider:status', configurePi: 'aiProvider:configurePi', configurePiOAuth: 'aiProvider:configurePiOAuth', answerPiAuth: 'aiProvider:answerPiAuth', cancelPiAuth: 'aiProvider:cancelPiAuth', useLocal: 'aiProvider:useLocal', clearPiCredential: 'aiProvider:clearPiCredential' },
  update: {
    getStatus: 'update:getStatus',
    checkNow: 'update:checkNow',
    downloadUpdate: 'update:downloadUpdate',
    installAndRestart: 'update:installAndRestart',
    openUpdatePage: 'update:openUpdatePage',
  },
  startup: {
    getSettings: 'startup:getSettings',
    setOpenAtLogin: 'startup:setOpenAtLogin',
    setSpeakerLabelsEnabled: 'startup:setSpeakerLabelsEnabled',
  },
} as const satisfies IpcOperationChannels

export const IPC_EVENTS = {
  recording: {
    statusChanged: 'recording:status-changed',
  },
  managedRuntime: {
    changed: 'managedRuntime:changed',
  },
  update: {
    statusChanged: 'update:status-changed',
  },
  aiProvider: {
    auth: 'aiProvider:auth',
  },

} as const

export type GappdApi = IpcInvokeApi & {
  recording: IpcInvokeApi['recording'] & {
    onStatusChanged(listener: (state: RecordingState) => void): () => void
  }
  managedRuntime: IpcInvokeApi['managedRuntime'] & {
    observe(listener: (state: ManagedRuntimeSnapshot) => void): () => void
  }
  update: IpcInvokeApi['update'] & {
    onStatusChanged(listener: (state: UpdateStatus) => void): () => void
  }
  aiProvider: IpcInvokeApi['aiProvider'] & {
    onAuthEvent(listener: (event: PiAuthEvent) => void): () => void
  }
}
