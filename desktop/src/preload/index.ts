import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENTS, IPC_OPERATIONS, type GappdApi, type IpcInvokeApi, type IpcOperationArgs, type IpcOperationGroup, type IpcOperationName, type IpcOperationResult } from '../shared/ipc-contract'

function subscribe<T>(channel: string): (listener: (state: T) => void) => () => void {
  return (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: T) => listener(state)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

function buildOperationApi(): IpcInvokeApi {
  return {
    system: invokeGroup('system'),
    meetings: invokeGroup('meetings'),
    recording: invokeGroup('recording'),
    localAISetup: invokeGroup('localAISetup'),
    update: invokeGroup('update'),
    startup: invokeGroup('startup'),
  }
}

function invokeGroup<G extends IpcOperationGroup>(group: G): IpcInvokeApi[G] {
  const api: Partial<Record<IpcOperationName<G>, unknown>> = {}
  for (const name of operationNames(group)) api[name] = invokeOperation(group, name)
  return api as IpcInvokeApi[G]
}

function operationNames<G extends IpcOperationGroup>(group: G): IpcOperationName<G>[] {
  return Object.keys(IPC_OPERATIONS[group]) as IpcOperationName<G>[]
}

function invokeOperation<G extends IpcOperationGroup, N extends IpcOperationName<G>>(group: G, name: N) {
  const channels = IPC_OPERATIONS[group] as Record<IpcOperationName<G>, string>
  return (...args: IpcOperationArgs<G, N>) => ipcRenderer.invoke(channels[name], ...args) as Promise<IpcOperationResult<G, N>>
}

const operationApi = buildOperationApi()

const api: GappdApi = {
  ...operationApi,
  recording: { ...operationApi.recording, onStatusChanged: subscribe(IPC_EVENTS.recording.statusChanged) },
  localAISetup: { ...operationApi.localAISetup, onStatusChanged: subscribe(IPC_EVENTS.localAISetup.statusChanged) },
  update: { ...operationApi.update, onStatusChanged: subscribe(IPC_EVENTS.update.statusChanged) },
}

contextBridge.exposeInMainWorld('gappd', api)
