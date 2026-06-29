import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENTS, IPC_OPERATIONS, type GappdApi, type IpcOperation } from '../shared/ipc-contract'

function subscribe<T>(channel: string): (listener: (state: T) => void) => () => void {
  return (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: T) => listener(state)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

type OperationApi = {
  system: GappdApi['system']
  meetings: GappdApi['meetings']
  recording: Omit<GappdApi['recording'], 'onStatusChanged'>
  onboarding: Omit<GappdApi['onboarding'], 'onStatusChanged'>
  settings: Omit<GappdApi['settings'], 'onWhisperModelDownloadProgress'>
  update: Omit<GappdApi['update'], 'onStatusChanged'>
}

type OperationInvoker = (...args: unknown[]) => Promise<unknown>

function buildOperationApi(): OperationApi {
  const api = emptyOperationApi()
  for (const operation of IPC_OPERATIONS) assignOperation(api, operation)
  return api
}

function emptyOperationApi(): OperationApi {
  return { system: {}, meetings: {}, recording: {}, onboarding: {}, settings: {}, update: {} } as OperationApi
}

function assignOperation(api: OperationApi, operation: IpcOperation): void {
  const group = api[operation.group] as Record<string, OperationInvoker>
  group[operation.name] = (...args) => ipcRenderer.invoke(operation.channel, ...args)
}

const operationApi = buildOperationApi()

const api: GappdApi = {
  ...operationApi,
  recording: { ...operationApi.recording, onStatusChanged: subscribe(IPC_EVENTS.recording.statusChanged) },
  onboarding: { ...operationApi.onboarding, onStatusChanged: subscribe(IPC_EVENTS.onboarding.statusChanged) },
  settings: { ...operationApi.settings, onWhisperModelDownloadProgress: subscribe(IPC_EVENTS.settings.whisperModelDownloadProgress) },
  update: { ...operationApi.update, onStatusChanged: subscribe(IPC_EVENTS.update.statusChanged) },
}

contextBridge.exposeInMainWorld('gappd', api)
