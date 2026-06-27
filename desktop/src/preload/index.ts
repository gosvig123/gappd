import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type GappdApi } from '../shared/ipc-contract'

function subscribe<T>(channel: string): (listener: (state: T) => void) => () => void {
  return (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: T) => listener(state)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: GappdApi = {
  system: {
    getDevices: () => ipcRenderer.invoke(IPC_CHANNELS.system.getDevices),
    requestCapturePermissions: () => ipcRenderer.invoke(IPC_CHANNELS.system.requestCapturePermissions),
    openPermissionsSettings: (target) => ipcRenderer.invoke(IPC_CHANNELS.system.openPermissionsSettings, target),
    startStaleRecordingRecovery: () => ipcRenderer.invoke(IPC_CHANNELS.system.startStaleRecordingRecovery),
  },
  meetings: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.meetings.list),
    show: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetings.show, id),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetings.delete, id),
  },
  recording: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.recording.start, input),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.recording.stop),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.recording.getStatus),
    onStatusChanged: subscribe(IPC_EVENTS.recording.statusChanged),
  },
  onboarding: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.onboarding.getStatus),
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.onboarding.start, input),
    retry: (input) => ipcRenderer.invoke(IPC_CHANNELS.onboarding.retry, input),
    onStatusChanged: subscribe(IPC_EVENTS.onboarding.statusChanged),
  },
  settings: {
    getLocalAIStatus: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getLocalAIStatus),
    repairLocalAI: () => ipcRenderer.invoke(IPC_CHANNELS.settings.repairLocalAI),
    getTranscriptionSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getTranscriptionSettings),
    downloadWhisperModel: (id) => ipcRenderer.invoke(IPC_CHANNELS.settings.downloadWhisperModel, id),
    setDefaultWhisperModel: (id) => ipcRenderer.invoke(IPC_CHANNELS.settings.setDefaultWhisperModel, id),
    onWhisperModelDownloadProgress: subscribe(IPC_EVENTS.settings.whisperModelDownloadProgress),
  },
  update: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.update.getStatus),
    checkNow: () => ipcRenderer.invoke(IPC_CHANNELS.update.checkNow),
    downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.update.downloadUpdate),
    installAndRestart: () => ipcRenderer.invoke(IPC_CHANNELS.update.installAndRestart),
    openUpdatePage: () => ipcRenderer.invoke(IPC_CHANNELS.update.openUpdatePage),
    onStatusChanged: subscribe(IPC_EVENTS.update.statusChanged),
  },
}

contextBridge.exposeInMainWorld('gappd', api)
