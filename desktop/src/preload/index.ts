import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type GappdApi, type OnboardingStatus, type RecordingState } from '../shared/ipc-contract'

const api: GappdApi = {
  system: {
    getDevices: () => ipcRenderer.invoke(IPC_CHANNELS.system.getDevices),
    requestCapturePermissions: () => ipcRenderer.invoke(IPC_CHANNELS.system.requestCapturePermissions),
    openPermissionsSettings: (target) => ipcRenderer.invoke(IPC_CHANNELS.system.openPermissionsSettings, target),
  },
  meetings: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.meetings.list),
    show: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetings.show, id),
  },
  recording: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.recording.start, input),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.recording.stop),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.recording.getStatus),
    onStatusChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: RecordingState) => listener(state)
      ipcRenderer.on(IPC_EVENTS.recording.statusChanged, wrapped)
      return () => ipcRenderer.removeListener(IPC_EVENTS.recording.statusChanged, wrapped)
    },
  },
  onboarding: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.onboarding.getStatus),
    start: () => ipcRenderer.invoke(IPC_CHANNELS.onboarding.start),
    retry: () => ipcRenderer.invoke(IPC_CHANNELS.onboarding.retry),
    onStatusChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: OnboardingStatus) => listener(state)
      ipcRenderer.on(IPC_EVENTS.onboarding.statusChanged, wrapped)
      return () => ipcRenderer.removeListener(IPC_EVENTS.onboarding.statusChanged, wrapped)
    },
  },
  settings: {
    getLocalAIStatus: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getLocalAIStatus),
    repairLocalAI: () => ipcRenderer.invoke(IPC_CHANNELS.settings.repairLocalAI),
  },
  update: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.update.getStatus),
    openUpdatePage: () => ipcRenderer.invoke(IPC_CHANNELS.update.openUpdatePage),
  },
}

contextBridge.exposeInMainWorld('gappd', api)
