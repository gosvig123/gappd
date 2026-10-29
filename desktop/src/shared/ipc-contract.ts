import type { MeetingUploadStatus } from './meeting-upload-contract'
import type { CalendarParticipant, CalendarSnapshot, GmailThread, GoogleAccess } from './calendar-contract'
import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem, RecordingState, UpdateStatus } from './contracts'
import type { ManagedRuntimePrepareMode, ManagedRuntimeSnapshot } from './managed-runtime'
import type { AgentId } from './agents'
import type { UsageReportStatus, UsageReportView } from './usage-report'
import type { Agenda, AgendaItem } from './agenda'
import type { AssignSpeakerInput, ImportPeopleResult, LinkCalendarInput, MergePeopleInput, ParticipantContext, PersonActionItem, SavedPerson, UpdatePersonInput, SpeakerClip, SpeakerClipInput } from './participant-contract'
export type { ManagedRuntimeSnapshot, RecordingState, UpdateStatus } from './contracts'

export type CapturePermissionTarget = 'microphone' | 'screen-recording'
export type CapturePermissionDetails = Record<string, string>
export type CapturePermissions = { microphone: string; screen: string; details?: CapturePermissionDetails }
export type StartRecordingInput = { title?: string; device?: number; mode?: string; language?: string; speakerLabelsEnabled?: boolean; eventSourceId?: string }
export type ManagedRuntimePrepareInput = { mode: ManagedRuntimePrepareMode; model?: string }
export type StartupSettings = { openAtLogin: boolean; supported: boolean; requiresApproval: boolean; speakerLabelsEnabled: boolean; screenVideoEnabled: boolean; agendaAutoDraftEnabled: boolean }
export type { AgentId } from './agents'
/** The newest install of one agent CLI on this Mac. executable is empty when it is not installed. */
export type AgentInstall = { agent: AgentId; executable: string; version: string; signedIn: boolean }
export type AIProviderStatus = { provider: 'local' | AgentId; agentExecutable: string; agentModel: string; agentReasoningEffort: string; available: boolean; error?: string }
export type AgentConfigurationInput = { agent: AgentId; executable: string; model: string; reasoningEffort: string }
/** reasoningEfforts is empty when the model has no reasoning effort setting. */
export type AgentModelOption = { id: string; displayName: string; defaultReasoningEffort: string; reasoningEfforts: string[]; isDefault: boolean }
export type AgentModelCatalog = { models: AgentModelOption[]; defaultModel: string; defaultReasoningEffort: string }

type OperationSpec<Args extends unknown[], Result> = { args: Args; result: Result }

export type IpcInvokeContract = {
  meetingUpload: { status: OperationSpec<[], MeetingUploadStatus>; connect: OperationSpec<[enabled: boolean], MeetingUploadStatus>; setConsent: OperationSpec<[subject: string, enabled: boolean], MeetingUploadStatus>; enqueue: OperationSpec<[localId: string], MeetingUploadStatus>; sync: OperationSpec<[], MeetingUploadStatus>; setAccountDeleteConsent: OperationSpec<[subject: string, enabled: boolean], MeetingUploadStatus>; deleteAll: OperationSpec<[], MeetingUploadStatus>; allowUploads: OperationSpec<[], MeetingUploadStatus>; setRevokeConsent: OperationSpec<[subject: string, enabled: boolean, clientId: string], MeetingUploadStatus>; revokeClient: OperationSpec<[subject: string, clientId: string], MeetingUploadStatus>; knownClients: OperationSpec<[], string[]>; setDeleteConsent: OperationSpec<[subject: string, enabled: boolean, localId: string], MeetingUploadStatus>; deleteCopy: OperationSpec<[subject: string, localId: string], MeetingUploadStatus> }
  system: {
    getDevices: OperationSpec<[], Device[]>
    checkCapturePermissions: OperationSpec<[], CapturePermissions>
    requestCapturePermissions: OperationSpec<[], CapturePermissions>
    openPermissionsSettings: OperationSpec<[target?: CapturePermissionTarget], void>
    startStaleRecordingRecovery: OperationSpec<[], number>
    relaunch: OperationSpec<[], void>
  }
  meetings: {
    list: OperationSpec<[], MeetingListItem[]>
    show: OperationSpec<[id: string], MeetingDetail>
    retryDiarization: OperationSpec<[id: string], MeetingDetail>
    delete: OperationSpec<[id: string], MeetingDeleteResponse>
    people: OperationSpec<[], SavedPerson[]>
    updatePerson: OperationSpec<[input: UpdatePersonInput], SavedPerson[]>
    mergePeople: OperationSpec<[input: MergePeopleInput], SavedPerson[]>
    personActionItems: OperationSpec<[id: string], PersonActionItem[]>
    importGoogleContacts: OperationSpec<[], ImportPeopleResult>
    assignSpeaker: OperationSpec<[input: AssignSpeakerInput], MeetingDetail>
    speakerClip: OperationSpec<[input: SpeakerClipInput], SpeakerClip>
    participantContext: OperationSpec<[id: string], ParticipantContext>
    linkCalendar: OperationSpec<[input: LinkCalendarInput], ParticipantContext>
    exportRecording: OperationSpec<[id: string], boolean>
  }
  agenda: {
    list: OperationSpec<[], Record<string, Agenda>>
    draft: OperationSpec<[eventKey: string], Agenda>
    save: OperationSpec<[eventKey: string, items: AgendaItem[]], Agenda>
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
    find: OperationSpec<[], AgentInstall[]>
    models: OperationSpec<[agent: AgentId, executable?: string], AgentModelCatalog>
    configureAgent: OperationSpec<[input: AgentConfigurationInput], AIProviderStatus>
    useLocal: OperationSpec<[], AIProviderStatus>
  }
  googleCalendar: {
    snapshot: OperationSpec<[], CalendarSnapshot>
    contacts: OperationSpec<[], CalendarParticipant[]>
    connect: OperationSpec<[access?: GoogleAccess[]], CalendarSnapshot>
    sync: OperationSpec<[connectionId: string], CalendarSnapshot>
    disconnect: OperationSpec<[connectionId: string], CalendarSnapshot>
    gmailThreads: OperationSpec<[personEmail: string], GmailThread[]>
    openGmailThread: OperationSpec<[accountEmail: string, threadId: string], void>
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
    setScreenVideoEnabled: OperationSpec<[enabled: boolean], StartupSettings>
    setAgendaAutoDraftEnabled: OperationSpec<[enabled: boolean], StartupSettings>
  }
  usage: {
    status: OperationSpec<[], UsageReportStatus>
    setSharing: OperationSpec<[enabled: boolean], UsageReportStatus>
    report: OperationSpec<[], UsageReportView>
  }
}

export type IpcOperationGroup = Extract<keyof IpcInvokeContract, string>
export type IpcOperationName<G extends IpcOperationGroup> = Extract<keyof IpcInvokeContract[G], string>
export type IpcOperationArgs<G extends IpcOperationGroup, N extends IpcOperationName<G>> = IpcInvokeContract[G][N] extends { args: infer Args extends unknown[] } ? Args : never
export type IpcOperationResult<G extends IpcOperationGroup, N extends IpcOperationName<G>> = IpcInvokeContract[G][N] extends { result: infer Result } ? Result : never
export type IpcInvokeApi = { [G in IpcOperationGroup]: { [N in IpcOperationName<G>]: (...args: IpcOperationArgs<G, N>) => Promise<IpcOperationResult<G, N>> } }

type IpcOperationChannels = { [G in IpcOperationGroup]: { [N in IpcOperationName<G>]: `${G}:${string}` } }

export const IPC_OPERATIONS = {
  meetingUpload: { status: 'meetingUpload:status', connect: 'meetingUpload:connect', setConsent: 'meetingUpload:setConsent', enqueue: 'meetingUpload:enqueue', sync: 'meetingUpload:sync', setAccountDeleteConsent: 'meetingUpload:setAccountDeleteConsent', deleteAll: 'meetingUpload:deleteAll', allowUploads: 'meetingUpload:allowUploads', setRevokeConsent: 'meetingUpload:setRevokeConsent', revokeClient: 'meetingUpload:revokeClient', knownClients: 'meetingUpload:knownClients', setDeleteConsent: 'meetingUpload:setDeleteConsent', deleteCopy: 'meetingUpload:deleteCopy' },
  system: {
    getDevices: 'system:getDevices',
    checkCapturePermissions: 'system:checkCapturePermissions',
    requestCapturePermissions: 'system:requestCapturePermissions',
    openPermissionsSettings: 'system:openPermissionsSettings',
    startStaleRecordingRecovery: 'system:startStaleRecordingRecovery',
    relaunch: 'system:relaunch',
  },
  meetings: {
    list: 'meetings:list', show: 'meetings:show', retryDiarization: 'meetings:retryDiarization', delete: 'meetings:delete',
    people: 'meetings:people', updatePerson: 'meetings:updatePerson', mergePeople: 'meetings:mergePeople', personActionItems: 'meetings:personActionItems', importGoogleContacts: 'meetings:importGoogleContacts', assignSpeaker: 'meetings:assignSpeaker', speakerClip: 'meetings:speakerClip',
    participantContext: 'meetings:participantContext', linkCalendar: 'meetings:linkCalendar',
    exportRecording: 'meetings:exportRecording',
  },
  agenda: { list: 'agenda:list', draft: 'agenda:draft', save: 'agenda:save' },
  recording: { start: 'recording:start', stop: 'recording:stop', getStatus: 'recording:getStatus' },
  managedRuntime: { status: 'managedRuntime:status', prepare: 'managedRuntime:prepare' },
  aiProvider: { status: 'aiProvider:status', find: 'aiProvider:find', models: 'aiProvider:models', configureAgent: 'aiProvider:configureAgent', useLocal: 'aiProvider:useLocal' },
  googleCalendar: {
    snapshot: 'googleCalendar:snapshot', connect: 'googleCalendar:connect', contacts: 'googleCalendar:contacts',
    sync: 'googleCalendar:sync', disconnect: 'googleCalendar:disconnect', gmailThreads: 'googleCalendar:gmailThreads', openGmailThread: 'googleCalendar:openGmailThread',
  },
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
    setSpeakerLabelsEnabled: 'startup:setSpeakerLabelsEnabled', setScreenVideoEnabled: 'startup:setScreenVideoEnabled',
    setAgendaAutoDraftEnabled: 'startup:setAgendaAutoDraftEnabled',
  },
  usage: { status: 'usage:status', setSharing: 'usage:setSharing', report: 'usage:report' },
} as const satisfies IpcOperationChannels

export const IPC_EVENTS = {
  recording: {
    statusChanged: 'recording:status-changed',
  },
  managedRuntime: {
    changed: 'managedRuntime:changed',
  },
  googleCalendar: {
    changed: 'googleCalendar:changed',
  },
  agenda: {
    changed: 'agenda:changed',
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
  googleCalendar: IpcInvokeApi['googleCalendar'] & {
    onChanged(listener: (snapshot: CalendarSnapshot) => void): () => void
  }
  agenda: IpcInvokeApi['agenda'] & {
    onChanged(listener: (agendas: Record<string, Agenda>) => void): () => void
  }
  update: IpcInvokeApi['update'] & {
    onStatusChanged(listener: (state: UpdateStatus) => void): () => void
  }
}
