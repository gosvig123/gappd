import os from 'node:os'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type CapturePermissionTarget, type OnboardingSetupInput, type StartRecordingInput } from '../shared/ipc-contract'
import { deleteMeeting, getDevices, listMeetings, requestCapturePermissions, showMeeting, startRecording, startStaleRecordingRecovery, stopRecording } from './gappd'
import { getLocalAIStatus, getOnboardingStatus, onOnboardingStatusChange, repairLocalAI, retryOnboarding, startOnboarding } from './onboarding'
import { getRecordingState, onRecordingStateChange } from './state'
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

let registered = false
const windowSubscriptions = new WeakMap<BrowserWindow, () => void>()

export function registerIpc(mainWindow: BrowserWindow): void {
  if (!registered) {
    ipcMain.handle(IPC_CHANNELS.system.getDevices, () => getDevices())
    ipcMain.handle(IPC_CHANNELS.system.requestCapturePermissions, () => requestCapturePermissions())
    ipcMain.handle(IPC_CHANNELS.system.openPermissionsSettings, (_event, target?: CapturePermissionTarget) => openPermissionsSettings(target))
    ipcMain.handle(IPC_CHANNELS.system.startStaleRecordingRecovery, () => startStaleRecordingRecovery())
    ipcMain.handle(IPC_CHANNELS.meetings.list, () => listMeetings())
    ipcMain.handle(IPC_CHANNELS.meetings.show, (_event, id: string) => showMeeting(id))
    ipcMain.handle(IPC_CHANNELS.meetings.delete, (_event, id: string) => deleteMeeting(id))
    ipcMain.handle(IPC_CHANNELS.recording.start, async (_event, input: StartRecordingInput) => {
      await startRecording(input)
      return getRecordingState()
    })
    ipcMain.handle(IPC_CHANNELS.recording.stop, () => {
      stopRecording()
      return getRecordingState()
    })
    ipcMain.handle(IPC_CHANNELS.recording.getStatus, () => getRecordingState())
    ipcMain.handle(IPC_CHANNELS.onboarding.getStatus, () => getOnboardingStatus())
    ipcMain.handle(IPC_CHANNELS.onboarding.start, (_event, input?: OnboardingSetupInput) => startOnboarding(input))
    ipcMain.handle(IPC_CHANNELS.onboarding.retry, (_event, input?: OnboardingSetupInput) => retryOnboarding(input))
    ipcMain.handle(IPC_CHANNELS.settings.getLocalAIStatus, () => getLocalAIStatus())
    ipcMain.handle(IPC_CHANNELS.settings.repairLocalAI, () => repairLocalAI())
    ipcMain.handle(IPC_CHANNELS.update.getStatus, () => getUpdateStatus())
    ipcMain.handle(IPC_CHANNELS.update.checkNow, () => checkForUpdate())
    ipcMain.handle(IPC_CHANNELS.update.downloadUpdate, () => downloadUpdate())
    ipcMain.handle(IPC_CHANNELS.update.installAndRestart, () => installAndRestart())
    ipcMain.handle(IPC_CHANNELS.update.openUpdatePage, () => openUpdatePage())
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
