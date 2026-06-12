import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type CapturePermissionTarget, type OnboardingSetupInput, type StartRecordingInput } from '../shared/ipc-contract'
import { getDevices, listMeetings, requestCapturePermissions, showMeeting, startRecording, stopRecording } from './gappd'
import { getLocalAIStatus, getOnboardingStatus, onOnboardingStatusChange, repairLocalAI, retryOnboarding, startOnboarding } from './onboarding'
import { getRecordingState, onRecordingStateChange } from './state'
import { getUpdateStatus, openUpdatePage } from './update'

let registered = false

export function registerIpc(mainWindow: BrowserWindow): void {
  if (!registered) {
    ipcMain.handle(IPC_CHANNELS.system.getDevices, () => getDevices())
    ipcMain.handle(IPC_CHANNELS.system.requestCapturePermissions, () => requestCapturePermissions())
    ipcMain.handle(IPC_CHANNELS.system.openPermissionsSettings, async (_event, target?: CapturePermissionTarget) => {
      const urls: Record<CapturePermissionTarget, string> = {
        'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      }
      const url = (target && urls[target]) ?? 'x-apple.systempreferences:com.apple.preference.security'
      await shell.openExternal(url, { activate: true })
    })
    ipcMain.handle(IPC_CHANNELS.meetings.list, () => listMeetings())
    ipcMain.handle(IPC_CHANNELS.meetings.show, (_event, id: string) => showMeeting(id))
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
    ipcMain.handle(IPC_CHANNELS.update.openUpdatePage, () => openUpdatePage())
    registered = true
  }

  forwardToWindow(mainWindow, IPC_EVENTS.recording.statusChanged, onRecordingStateChange)
  forwardToWindow(mainWindow, IPC_EVENTS.onboarding.statusChanged, onOnboardingStatusChange)
}

function forwardToWindow<T>(mainWindow: BrowserWindow, channel: string, subscribe: (listener: (state: T) => void) => () => void): void {
  subscribe((state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, state)
  })
}
