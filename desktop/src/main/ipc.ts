import os from 'node:os'
import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC_EVENTS, IPC_OPERATIONS, type CapturePermissionTarget, type CodexConfigurationInput, type IpcOperationArgs, type IpcOperationGroup, type IpcOperationName, type IpcOperationResult, type ManagedRuntimePrepareInput, type StartRecordingInput } from '../shared/ipc-contract'
import { LOCAL_AI_PROVIDER_LLAMACPP } from '../shared/managed-local-ai'
import { requestCapturePermissions } from './capture-permissions'
import { requestDrains } from './drain-coordinator'
import { managedRuntime } from './managed-runtime'
import { configureCodex, providerStatus, useLocalProvider } from './ai-provider'
import { connectGoogleCalendar, disconnectGoogleCalendar, googleCalendarSnapshot, syncGoogleCalendar } from './google-calendar-service'
import { deleteMeeting, getDevices, listMeetings, retryDiarization, showMeeting } from './meetings'
import { startMeetingRecordingWorkflow, stopMeetingRecordingWorkflow } from './meeting-recording-workflow'
import { getRecordingState, onRecordingStateChange } from './state'
import { startStaleRecordingRecovery } from './stale-recording-recovery'
import { getStartupSettings, setOpenAtLogin, setSpeakerLabelsEnabled } from './startup-settings'
import { checkForUpdate, downloadUpdate, getUpdateStatus, installAndRestart, onUpdateStatusChange, openUpdatePage } from './update'

const SYSTEM_SETTINGS_DARWIN_MAJOR = 22
const LEGACY_PRIVACY_SECURITY_PANE = 'com.apple.preference.security'
const MODERN_PRIVACY_SECURITY_PANE = 'com.apple.settings.PrivacySecurity.extension'
const PRIVACY_MAIN_ANCHOR = 'Privacy'
const PRIVACY_MICROPHONE_ANCHOR = 'Privacy_Microphone'
const PRIVACY_SCREEN_CAPTURE_ANCHOR = 'Privacy_ScreenCapture'
const PRIVACY_ANCHORS: Record<CapturePermissionTarget, string> = {
  'microphone': PRIVACY_MICROPHONE_ANCHOR,
  'screen-recording': PRIVACY_SCREEN_CAPTURE_ANCHOR,
}

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
    configureCodex: (_event, input: CodexConfigurationInput) => providerChanged(() => configureCodex(input)),
    useLocal: () => providerChanged(useLocalProvider),
  },
  googleCalendar: {
    snapshot: () => googleCalendarSnapshot(),
    connect: () => connectGoogleCalendar(),
    sync: (_event, connectionId: string) => syncGoogleCalendar(connectionId),
    disconnect: (_event, connectionId: string) => disconnectGoogleCalendar(connectionId),
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

function privacySettingsUrl(target?: CapturePermissionTarget): string {
  const anchor = target ? PRIVACY_ANCHORS[target] : legacyPrivacyAnchor()
  const suffix = anchor ? `?${anchor}` : ''
  return `x-apple.systempreferences:${privacySecurityPane()}${suffix}`
}

function privacySecurityPane(): string {
  return usesModernPrivacyPane() ? MODERN_PRIVACY_SECURITY_PANE : LEGACY_PRIVACY_SECURITY_PANE
}

function legacyPrivacyAnchor(): string {
  return usesModernPrivacyPane() ? '' : PRIVACY_MAIN_ANCHOR
}

function usesModernPrivacyPane(): boolean {
  if (process.platform !== 'darwin') return true
  const darwinMajor = Number.parseInt(os.release().split('.')[0] ?? '', 10)
  return Number.isNaN(darwinMajor) || darwinMajor >= SYSTEM_SETTINGS_DARWIN_MAJOR
}

async function openPermissionsSettings(target?: CapturePermissionTarget): Promise<void> {
  await shell.openExternal(privacySettingsUrl(target), { activate: true })
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
