import os from 'node:os'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC_EVENTS, IPC_OPERATIONS, type CapturePermissionTarget, type IpcOperationChannel, type OnboardingSetupInput, type StartRecordingInput } from '../shared/ipc-contract'
import { deleteMeeting, getDevices, listMeetings, requestCapturePermissions, showMeeting, startRecording, startStaleRecordingRecovery, stopRecording } from './gappd'
import { getLocalAIStatus, getOnboardingStatus, onOnboardingStatusChange, repairLocalAI, retryOnboarding, startOnboarding } from './onboarding'
import { getRecordingState, onRecordingStateChange } from './state'
import { checkForUpdate, downloadUpdate, getUpdateStatus, installAndRestart, onUpdateStatusChange, openUpdatePage } from './update'
import { downloadWhisperModel, getTranscriptionSettings, saveDefaultWhisperModel } from './whisper-model-settings'

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

type IpcHandler = Parameters<typeof ipcMain.handle>[1]

const IPC_HANDLERS: Record<IpcOperationChannel, IpcHandler> = {
  'system:getDevices': () => getDevices(),
  'system:requestCapturePermissions': () => requestCapturePermissions(),
  'system:openPermissionsSettings': (_event, target?: CapturePermissionTarget) => openPermissionsSettings(target),
  'system:startStaleRecordingRecovery': () => startStaleRecordingRecovery(),
  'meetings:list': () => listMeetings(),
  'meetings:show': (_event, id: string) => showMeeting(id),
  'meetings:delete': (_event, id: string) => deleteMeeting(id),
  'recording:start': async (_event, input: StartRecordingInput) => {
    await startRecording(input)
    return getRecordingState()
  },
  'recording:stop': () => {
    stopRecording()
    return getRecordingState()
  },
  'recording:getStatus': () => getRecordingState(),
  'onboarding:getStatus': () => getOnboardingStatus(),
  'onboarding:start': (_event, input?: OnboardingSetupInput) => startOnboarding(input),
  'onboarding:retry': (_event, input?: OnboardingSetupInput) => retryOnboarding(input),
  'settings:getLocalAIStatus': () => getLocalAIStatus(),
  'settings:repairLocalAI': () => repairLocalAI(),
  'settings:getTranscriptionSettings': () => getTranscriptionSettings(),
  'settings:downloadWhisperModel': (event, id: string) => downloadWhisperModel(id, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.settings.whisperModelDownloadProgress, progress)
  }),
  'settings:setDefaultWhisperModel': (_event, id: string) => saveDefaultWhisperModel(id),
  'update:getStatus': () => getUpdateStatus(),
  'update:checkNow': () => checkForUpdate(),
  'update:downloadUpdate': () => downloadUpdate(),
  'update:installAndRestart': () => installAndRestart(),
  'update:openUpdatePage': () => openUpdatePage(),
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
    forwardToWindow(mainWindow, IPC_EVENTS.onboarding.statusChanged, onOnboardingStatusChange),
    forwardToWindow(mainWindow, IPC_EVENTS.update.statusChanged, onUpdateStatusChange),
  ]
  windowSubscriptions.set(mainWindow, () => disposers.forEach((dispose) => dispose()))
  mainWindow.once('closed', () => disposeWindowSubscriptions(mainWindow))
}

function registerIpcHandlers(): void {
  for (const operation of IPC_OPERATIONS) ipcMain.handle(operation.channel, IPC_HANDLERS[operation.channel])
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
