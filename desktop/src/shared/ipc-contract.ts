import type { SelectedFixtureStatus } from './selected-fixture-contract'
import type { DemoUploadStatus } from './demo-upload-contract'
import type { CloudAuthStatus } from './cloud-auth-contract'
import type { MeetingUploadStatus } from './meeting-upload-contract'
import type { MeetingAgendaDraft } from './meeting-agenda'
import type { GeneratedAgenda, AgendaDraftWriteResult, AgendaDraftRemoveResult, AgendaDraftSaveInput, SavedAgendaDraft } from './agenda-draft'
import type { CalendarParticipant, CalendarSnapshot } from './calendar-contract'
import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem, RecordingState, UpdateStatus } from './contracts'
import type { ManagedRuntimePrepareMode, ManagedRuntimeSnapshot } from './managed-runtime'
import type { AssignSpeakerInput, LinkCalendarInput, ParticipantContext, SavedPerson, SpeakerClip, SpeakerClipInput } from './participant-contract'
import type { SlackConnectionStatus, SlackDestinationPage, SlackSendResult, SlackSendReview, SlackSendReviewInput } from './slack-contract'
export type { ManagedRuntimeSnapshot, RecordingState, UpdateStatus } from './contracts'

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissionDetails = Record<string, string>
export type CapturePermissions = { microphone: string; screen: string; details?: CapturePermissionDetails }
export type StartRecordingInput = { title?: string; device?: number; mode?: string; language?: string; speakerLabelsEnabled?: boolean; eventSourceId?: string }
export type ManagedRuntimePrepareInput = { mode: ManagedRuntimePrepareMode; model?: string }
export type StartupSettings = { openAtLogin: boolean; supported: boolean; requiresApproval: boolean; speakerLabelsEnabled: boolean }
export type AIProviderStatus = { provider: 'local' | 'codex_exec'; codexExecutable: string; codexModel: string; codexReasoningEffort: string; available: boolean; error?: string }
export type CodexConfigurationInput = { executable: string; model: string; reasoningEffort: string }
export type CodexModelOption = { id: string; displayName: string; defaultReasoningEffort: string; reasoningEfforts: string[]; isDefault: boolean }
export type CodexModelCatalog = { models: CodexModelOption[]; defaultModel: string; defaultReasoningEffort: string }
export type GenerateAgendaInput = { sourceId: string; expectedRevision: number; slackChannelIds?: string[] }

type OperationSpec<Args extends unknown[], Result> = { args: Args; result: Result }

export type IpcInvokeContract = {
  selectedFixture: { status: OperationSpec<[], SelectedFixtureStatus>; preview: OperationSpec<[id: string], SelectedFixtureStatus>; cancel: OperationSpec<[], void>; connect: OperationSpec<[enabled: boolean], SelectedFixtureStatus>; setConsent: OperationSpec<[subject: string, enabled: boolean, action: 'upload' | 'delete'], SelectedFixtureStatus>; perform: OperationSpec<[subject: string, action: 'upload' | 'delete'], SelectedFixtureStatus> }
  demoUpload: { status: OperationSpec<[], DemoUploadStatus>; connect: OperationSpec<[enabled: boolean], DemoUploadStatus>; setConsent: OperationSpec<[subject: string, enabled: boolean], DemoUploadStatus>; upload: OperationSpec<[subject: string], DemoUploadStatus>; setDeleteConsent: OperationSpec<[subject: string, enabled: boolean], DemoUploadStatus>; deleteCopy: OperationSpec<[subject: string], DemoUploadStatus> }
  cloudAuth: { status: OperationSpec<[], CloudAuthStatus>; setEnabled: OperationSpec<[enabled: boolean], CloudAuthStatus> }
  meetingUpload: { status: OperationSpec<[], MeetingUploadStatus>; connect: OperationSpec<[enabled: boolean], MeetingUploadStatus>; setConsent: OperationSpec<[subject: string, enabled: boolean], MeetingUploadStatus>; enqueue: OperationSpec<[localId: string], MeetingUploadStatus>; sync: OperationSpec<[], MeetingUploadStatus>; setAccountDeleteConsent: OperationSpec<[subject: string, enabled: boolean], MeetingUploadStatus>; deleteAll: OperationSpec<[], MeetingUploadStatus>; allowUploads: OperationSpec<[], MeetingUploadStatus>; setRevokeConsent: OperationSpec<[subject: string, enabled: boolean, clientId: string], MeetingUploadStatus>; revokeClient: OperationSpec<[subject: string, clientId: string], MeetingUploadStatus>; knownClients: OperationSpec<[], string[]>; setDeleteConsent: OperationSpec<[subject: string, enabled: boolean, localId: string], MeetingUploadStatus>; deleteCopy: OperationSpec<[subject: string, localId: string], MeetingUploadStatus> }
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
    people: OperationSpec<[], SavedPerson[]>
    assignSpeaker: OperationSpec<[input: AssignSpeakerInput], MeetingDetail>
    speakerClip: OperationSpec<[input: SpeakerClipInput], SpeakerClip>
    participantContext: OperationSpec<[id: string], ParticipantContext>
    linkCalendar: OperationSpec<[input: LinkCalendarInput], ParticipantContext>
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
    models: OperationSpec<[executable?: string], CodexModelCatalog>
    configureCodex: OperationSpec<[input: CodexConfigurationInput], AIProviderStatus>
    useLocal: OperationSpec<[], AIProviderStatus>
  }
  agenda: {
    load: OperationSpec<[draftKey: string], SavedAgendaDraft | null>
    list: OperationSpec<[], SavedAgendaDraft[]>
    save: OperationSpec<[input: AgendaDraftSaveInput], AgendaDraftWriteResult>
    remove: OperationSpec<[draftKey: string], AgendaDraftRemoveResult>
  }
  googleCalendar: {
    generateAgenda: OperationSpec<[input: GenerateAgendaInput], GeneratedAgenda>
    snapshot: OperationSpec<[], CalendarSnapshot>
    contacts: OperationSpec<[], CalendarParticipant[]>
    connect: OperationSpec<[includeGmail?: boolean], CalendarSnapshot>
    sync: OperationSpec<[connectionId: string], CalendarSnapshot>
    disconnect: OperationSpec<[connectionId: string], CalendarSnapshot>
  }
  slack: {
    status: OperationSpec<[], SlackConnectionStatus>
    connect: OperationSpec<[], SlackConnectionStatus>
    disconnect: OperationSpec<[], SlackConnectionStatus>
    destinations: OperationSpec<[cursor?: string], SlackDestinationPage>
    review: OperationSpec<[input: SlackSendReviewInput], SlackSendReview>
    send: OperationSpec<[reviewId: string], SlackSendResult>
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
  selectedFixture: { status: 'selectedFixture:status', preview: 'selectedFixture:preview', cancel: 'selectedFixture:cancel', connect: 'selectedFixture:connect', setConsent: 'selectedFixture:setConsent', perform: 'selectedFixture:perform' },
  demoUpload: { status: 'demoUpload:status', connect: 'demoUpload:connect', setConsent: 'demoUpload:setConsent', upload: 'demoUpload:upload', setDeleteConsent: 'demoUpload:setDeleteConsent', deleteCopy: 'demoUpload:deleteCopy' },
  cloudAuth: { status: 'cloudAuth:status', setEnabled: 'cloudAuth:setEnabled' },
  meetingUpload: { status: 'meetingUpload:status', connect: 'meetingUpload:connect', setConsent: 'meetingUpload:setConsent', enqueue: 'meetingUpload:enqueue', sync: 'meetingUpload:sync', setAccountDeleteConsent: 'meetingUpload:setAccountDeleteConsent', deleteAll: 'meetingUpload:deleteAll', allowUploads: 'meetingUpload:allowUploads', setRevokeConsent: 'meetingUpload:setRevokeConsent', revokeClient: 'meetingUpload:revokeClient', knownClients: 'meetingUpload:knownClients', setDeleteConsent: 'meetingUpload:setDeleteConsent', deleteCopy: 'meetingUpload:deleteCopy' },
  system: {
    getDevices: 'system:getDevices',
    requestCapturePermissions: 'system:requestCapturePermissions',
    openPermissionsSettings: 'system:openPermissionsSettings',
    startStaleRecordingRecovery: 'system:startStaleRecordingRecovery',
  },
  meetings: {
    list: 'meetings:list', show: 'meetings:show', retryDiarization: 'meetings:retryDiarization', delete: 'meetings:delete',
    people: 'meetings:people', assignSpeaker: 'meetings:assignSpeaker', speakerClip: 'meetings:speakerClip',
    participantContext: 'meetings:participantContext', linkCalendar: 'meetings:linkCalendar',
  },
  recording: { start: 'recording:start', stop: 'recording:stop', getStatus: 'recording:getStatus' },
  managedRuntime: { status: 'managedRuntime:status', prepare: 'managedRuntime:prepare' },
  aiProvider: { status: 'aiProvider:status', models: 'aiProvider:models', configureCodex: 'aiProvider:configureCodex', useLocal: 'aiProvider:useLocal' },
  agenda: { load: 'agenda:load', list: 'agenda:list', save: 'agenda:save', remove: 'agenda:remove' },
  googleCalendar: {
    generateAgenda: 'googleCalendar:generateAgenda',
    snapshot: 'googleCalendar:snapshot', connect: 'googleCalendar:connect', contacts: 'googleCalendar:contacts',
    sync: 'googleCalendar:sync', disconnect: 'googleCalendar:disconnect',
  },
  slack: { status: 'slack:status', connect: 'slack:connect', disconnect: 'slack:disconnect', destinations: 'slack:destinations', review: 'slack:review', send: 'slack:send' },
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
}
