import { selectedFixtureUpload } from './selected-fixture-service'
import { demoUpload } from './demo-upload-service'
import { generateMeetingAgenda } from './meeting-agenda'
import { openPermissionsSettings } from './privacy-settings'
import { cloudAuthStatus, setCloudAuthEnabled } from './cloud-auth-service'
import { meetingUpload } from './meeting-upload-service'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_EVENTS, IPC_OPERATIONS, type CapturePermissionTarget, type CodexConfigurationInput, type IpcOperationArgs, type IpcOperationGroup, type IpcOperationName, type IpcOperationResult, type ManagedRuntimePrepareInput, type StartRecordingInput } from '../shared/ipc-contract'
import { LOCAL_AI_PROVIDER_LLAMACPP } from '../shared/managed-local-ai'
import { requestCapturePermissions } from './capture-permissions'
import { requestDrains } from './drain-coordinator'
import { managedRuntime } from './managed-runtime'
import { configureCodex, providerModels, providerStatus, useLocalProvider } from './ai-provider'
import { listSavedAgendas, loadSavedAgenda, removeSavedAgenda, saveAgendaTopics } from './agenda-drafts'
import { connectGoogleCalendar, disconnectGoogleCalendar, googleCalendarSnapshot, syncGoogleCalendar } from './google-calendar-service'
import { connectSlack, disconnectSlack, reviewSlackMessage, sendSlackMessage, slackConnectionStatus } from './slack-service'
import { collectCalendarContacts } from '../shared/calendar-contacts'
import { assignSpeaker, deleteMeeting, getDevices, listMeetings, listPeople, retryDiarization, showMeeting, speakerClip } from './meetings'
import { linkCalendar, participantContext } from './participant-calendar'
import { startMeetingRecordingWorkflow, stopMeetingRecordingWorkflow } from './meeting-recording-workflow'
import { getRecordingState, onRecordingStateChange } from './state'
import { startStaleRecordingRecovery } from './stale-recording-recovery'
import { getStartupSettings, setOpenAtLogin, setSpeakerLabelsEnabled } from './startup-settings'
import { checkForUpdate, downloadUpdate, getUpdateStatus, installAndRestart, onUpdateStatusChange, openUpdatePage } from './update'

type Awaitable<T> = T | Promise<T>
type IpcHandler = Parameters<typeof ipcMain.handle>[1]
type MainHandler<G extends IpcOperationGroup, N extends IpcOperationName<G>> = (event: IpcMainInvokeEvent, ...args: IpcOperationArgs<G, N>) => Awaitable<IpcOperationResult<G, N>>
type MainHandlers = { [G in IpcOperationGroup]: { [N in IpcOperationName<G>]: MainHandler<G, N> } }

const IPC_HANDLERS: MainHandlers = {
  system: {
    getDevices: () => getDevices(),
    requestCapturePermissions: () => requestCapturePermissions(),
    openPermissionsSettings: (_event, target?: CapturePermissionTarget) => openPermissionsSettings(target),
    startStaleRecordingRecovery: () => startStaleRecordingRecovery(),
  },
  meetings: {
    list: () => listMeetings(),
    show: (_event, id: string) => showMeeting(id),
    retryDiarization: (_event, id: string) => retryDiarization(id),
    delete: (_event, id: string) => deleteMeeting(id),
    people: () => listPeople(),
    assignSpeaker: (_event, input) => assignSpeaker(input),
    speakerClip: (_event, input) => speakerClip(input),
    participantContext: (_event, id) => participantContext(id),
    linkCalendar: (_event, input) => linkCalendar(input),
  },
  recording: {
    start: (_event, input: StartRecordingInput) => startMeetingRecordingWorkflow(input),
    stop: () => stopMeetingRecordingWorkflow(),
    getStatus: () => getRecordingState(),
  },
  managedRuntime: {
    status: () => managedRuntime.status(),
    prepare: (_event, input: ManagedRuntimePrepareInput) => managedRuntime.prepare(input.mode, input.model),
  },
  aiProvider: {
    status: () => refreshedProviderStatus(),
    models: (_event, executable?: string) => providerModels(executable),
    configureCodex: (_event, input: CodexConfigurationInput) => providerChanged(() => configureCodex(input)),
    useLocal: () => providerChanged(useLocalProvider),
  },
  agenda: {
    load: (_event, draftKey: string) => loadSavedAgenda(draftKey),
    list: () => listSavedAgendas(),
    save: (_event, input) => saveAgendaTopics(input),
    remove: (_event, draftKey: string) => removeSavedAgenda(draftKey),
  },
  googleCalendar: {
    generateAgenda: (_event, input) => generateMeetingAgenda(input),
    snapshot: () => googleCalendarSnapshot(),
    contacts: async () => collectCalendarContacts((await googleCalendarSnapshot()).events),
    connect: () => connectGoogleCalendar(),
    sync: (_event, connectionId: string) => syncGoogleCalendar(connectionId),
    disconnect: (_event, connectionId: string) => disconnectGoogleCalendar(connectionId),
  },
  selectedFixture: { status: () => selectedFixtureUpload().status(), preview: (_event, id) => selectedFixtureUpload().preview(id), cancel: () => selectedFixtureUpload().cancel(), connect: (_event, enabled) => selectedFixtureUpload().connect(enabled), setConsent: (_event, subject, enabled, action) => selectedFixtureUpload().setConsent(subject, enabled, action), perform: (_event, subject, action) => selectedFixtureUpload().perform(subject, action) },
  demoUpload: { status: () => demoUpload().status(), connect: (_event, enabled) => demoUpload().connect(enabled), setConsent: (_event, subject, enabled) => demoUpload().setConsent(subject, enabled), upload: (_event, subject) => demoUpload().upload(subject), setDeleteConsent: (_event, subject, enabled) => demoUpload().setDeleteConsent(subject, enabled), deleteCopy: (_event, subject) => demoUpload().deleteCopy(subject) },
  cloudAuth: { status: () => cloudAuthStatus(), setEnabled: (_event, enabled) => setCloudAuthEnabled(enabled) },
  meetingUpload: { status: () => meetingUpload().status(), connect: (_event, enabled) => meetingUpload().connect(enabled), setConsent: (_event, subject, enabled) => meetingUpload().setConsent(subject, enabled), enqueue: (_event, localId) => meetingUpload().enqueue(localId), sync: () => meetingUpload().sync(), setAccountDeleteConsent: (_event, subject, enabled) => meetingUpload().setAccountDeleteConsent(subject, enabled), deleteAll: () => meetingUpload().deleteAll(), allowUploads: () => meetingUpload().allowUploads(), setRevokeConsent: (_event, subject, enabled, clientId) => meetingUpload().setRevokeConsent(subject, enabled, clientId), revokeClient: (_event, subject, clientId) => meetingUpload().revokeClient(subject, clientId), knownClients: () => meetingUpload().knownClients(), setDeleteConsent: (_event, subject, enabled, localId) => meetingUpload().setDeleteConsent(subject, enabled, localId), deleteCopy: (_event, subject, localId) => meetingUpload().deleteCopy(subject, localId) },
  slack: {
    status: () => slackConnectionStatus(),
    connect: () => connectSlack(),
    disconnect: () => disconnectSlack(),
    review: (_event, input) => reviewSlackMessage(input),
    send: (_event, reviewId) => sendSlackMessage(reviewId),
  },
  update: {
    getStatus: () => getUpdateStatus(),
    checkNow: () => checkForUpdate(),
    downloadUpdate: () => downloadUpdate(),
    installAndRestart: () => installAndRestart(),
    openUpdatePage: () => openUpdatePage(),
  },
  startup: {
    getSettings: () => getStartupSettings(),
    setOpenAtLogin: (_event, openAtLogin: boolean) => setOpenAtLogin(openAtLogin),
    setSpeakerLabelsEnabled: (_event, enabled: boolean) => setSpeakerLabelsEnabled(enabled),
  },
}

async function refreshedProviderStatus() {
  const generation = managedRuntime.providerGeneration()
  const result = await providerStatus()
  await managedRuntime.refresh(result.health, generation)
  return result.status
}

async function providerChanged(action: () => ReturnType<typeof configureCodex>) {
  const change = await managedRuntime.beginProviderChange()
  let resumeRepair = false
  let result: Awaited<ReturnType<typeof configureCodex>>
  try {
    result = await action()
    await managedRuntime.refresh(result.health, change.gate.generation)
    resumeRepair = isManagedLocal(result.health.ai)
  } catch (error) {
    resumeRepair = true
    await managedRuntime.refresh(undefined, change.gate.generation)
    throw error
  } finally {
    managedRuntime.endProviderChange(change, resumeRepair)
  }
  requestDrains()
  return result.status
}

function isManagedLocal(config: { provider: string; managed: boolean }): boolean {
  return config.provider === LOCAL_AI_PROVIDER_LLAMACPP && config.managed
}

let registered = false
const windowSubscriptions = new WeakMap<BrowserWindow, () => void>()

export function registerIpc(mainWindow: BrowserWindow): void {
  if (!registered) {
    registerIpcHandlers()
    registered = true
  }

  disposeWindowSubscriptions(mainWindow)
  const disposers = [
    forwardToWindow(mainWindow, IPC_EVENTS.recording.statusChanged, onRecordingStateChange),
    forwardToWindow(mainWindow, IPC_EVENTS.managedRuntime.changed, managedRuntime.observe),
    forwardToWindow(mainWindow, IPC_EVENTS.update.statusChanged, onUpdateStatusChange),
  ]
  windowSubscriptions.set(mainWindow, () => disposers.forEach((dispose) => dispose()))
  mainWindow.once('closed', () => disposeWindowSubscriptions(mainWindow))
}

function registerIpcHandlers(): void {
  for (const group of operationGroups()) registerIpcGroup(group)
}

function operationGroups(): IpcOperationGroup[] {
  return Object.keys(IPC_OPERATIONS) as IpcOperationGroup[]
}

function operationNames<G extends IpcOperationGroup>(group: G): IpcOperationName<G>[] {
  return Object.keys(IPC_OPERATIONS[group]) as IpcOperationName<G>[]
}

function registerIpcGroup<G extends IpcOperationGroup>(group: G): void {
  const channels = IPC_OPERATIONS[group] as Record<IpcOperationName<G>, string>
  for (const name of operationNames(group)) ipcMain.handle(channels[name], IPC_HANDLERS[group][name] as IpcHandler)
}

function disposeWindowSubscriptions(mainWindow: BrowserWindow): void {
  const dispose = windowSubscriptions.get(mainWindow)
  if (!dispose) return
  dispose()
  windowSubscriptions.delete(mainWindow)
}

function forwardToWindow<T>(mainWindow: BrowserWindow, channel: string, subscribe: (listener: (state: T) => void) => () => void): () => void {
  return subscribe((state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, state)
  })
}
