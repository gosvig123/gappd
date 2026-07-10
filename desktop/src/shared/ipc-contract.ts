import type { Device, LocalAISetupStatus, LocalAIStatus, MeetingDeleteResponse, MeetingDetail, MeetingListItem, RecordingState, UpdateStatus } from './contracts'
export type { LocalAISetupStatus, RecordingState, UpdateStatus } from './contracts'

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissionDetails = Record<string, string>
export type CapturePermissions = { microphone: string; screen: string; details?: CapturePermissionDetails }
export type StartRecordingInput = { title?: string; device?: number; mode?: string; language?: string }
export type LocalAISetupInput = { model?: string }
export type StartupSettings = { openAtLogin: boolean; supported: boolean; requiresApproval: boolean }

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
    delete: OperationSpec<[id: string], MeetingDeleteResponse>
  }
  recording: {
    start: OperationSpec<[input: StartRecordingInput], RecordingState>
    stop: OperationSpec<[], RecordingState>
    getStatus: OperationSpec<[], RecordingState>
  }
  localAISetup: {
    getStatus: OperationSpec<[], LocalAISetupStatus>
    getDetails: OperationSpec<[], LocalAIStatus>
    start: OperationSpec<[input?: LocalAISetupInput], LocalAISetupStatus>
    retry: OperationSpec<[input?: LocalAISetupInput], LocalAISetupStatus>
    repair: OperationSpec<[], LocalAIStatus>
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
  meetings: { list: 'meetings:list', show: 'meetings:show', delete: 'meetings:delete' },
  recording: { start: 'recording:start', stop: 'recording:stop', getStatus: 'recording:getStatus' },
  localAISetup: { getStatus: 'localAISetup:getStatus', getDetails: 'localAISetup:getDetails', start: 'localAISetup:start', retry: 'localAISetup:retry', repair: 'localAISetup:repair' },
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
  },
} as const satisfies IpcOperationChannels

export const IPC_EVENTS = {
  recording: {
    statusChanged: 'recording:status-changed',
  },
  localAISetup: {
    statusChanged: 'localAISetup:status-changed',
  },
  update: {
    statusChanged: 'update:status-changed',
  },

} as const

export type GappdApi = IpcInvokeApi & {
  recording: IpcInvokeApi['recording'] & {
    onStatusChanged(listener: (state: RecordingState) => void): () => void
  }
  localAISetup: IpcInvokeApi['localAISetup'] & {
    onStatusChanged(listener: (state: LocalAISetupStatus) => void): () => void
  }
  update: IpcInvokeApi['update'] & {
    onStatusChanged(listener: (state: UpdateStatus) => void): () => void
  }
}
