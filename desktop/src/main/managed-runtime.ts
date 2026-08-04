import type { CodexStatusResponse } from '../shared/generated/contracts'
import type { ManagedRuntimeCapability, ManagedRuntimePrepareMode, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { LOCAL_AI_PROVIDER_LLAMACPP, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_MODEL, MANAGED_LLAMACPP_MODEL_OPTIONS, isManagedLlamaCppModel } from '../shared/managed-local-ai'
import { requestCommand } from './app-protocol'
import { acquireManagedLlamaCpp, stopManagedLlamaCpp, type ManagedLlamaCppLease } from './llamacpp'
import { createObservableState } from './observable-state'
import { prepareManagedAssets, type PrepareProgress } from './managed-runtime-prepare'
import { createProviderChangeGate, type ProviderChangeToken } from './managed-runtime-provider-gate'
import { loadProviderProbe, resumeManagedRepair } from './managed-runtime-provider-lifecycle'
import { baseSnapshot, initialRuntimeSnapshot, probeRuntime, runtimeErrorSnapshot, type RuntimeProbe } from './managed-runtime-status'

export type RuntimeScope = { endpoint: string }
export type ManagedRuntime = {
  status(): ManagedRuntimeSnapshot
  observe(listener: (snapshot: ManagedRuntimeSnapshot) => void): () => void
  prepare(mode: ManagedRuntimePrepareMode, model?: string): Promise<ManagedRuntimeSnapshot>
  refresh(providerHealth?: CodexStatusResponse, providerGeneration?: number): Promise<ManagedRuntimeSnapshot>
  providerGeneration(): number
  beginProviderChange(): Promise<RuntimeProviderChange>
  endProviderChange(change: RuntimeProviderChange, resumeRepair: boolean): void
  using<T>(capabilities: ManagedRuntimeCapability[], work: (scope: RuntimeScope) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export type RuntimeProviderChange = { gate: ProviderChangeToken; prepare: Promise<ManagedRuntimeSnapshot> | null; model: string | null }

const state = createObservableState<ManagedRuntimeSnapshot>(initialRuntimeSnapshot())
const providerGate = createProviderChangeGate()
let preparePromise: Promise<ManagedRuntimeSnapshot> | null = null
let prepareModel: string | null = null
let refreshGeneration = 0
let activeUses = 0

export const managedRuntime: ManagedRuntime = {
  status: state.get,
  observe: state.subscribe,
  prepare,
  refresh: refreshStatus,
  providerGeneration: () => providerGate.generation(),
  beginProviderChange,
  endProviderChange,
  using: usingRuntime,
  close: closeRuntime,
}

export async function bootstrapManagedRuntime(): Promise<void> {
  const generation = ++refreshGeneration
  const probe = await loadProviderProbe()
  const snapshot = await publishProbe(probe, false, generation)
  if (probe.config?.provider === LOCAL_AI_PROVIDER_LLAMACPP && probe.config.managed && snapshot.operation !== 'ready') void prepare('repair', probe.config.model)
}

async function refreshStatus(providerHealth?: CodexStatusResponse, providerGeneration = providerGate.generation()): Promise<ManagedRuntimeSnapshot> {
  if (!providerGate.current(providerGeneration) || preparePromise && !providerHealth && !providerGate.changing()) return state.get()
  const generation = ++refreshGeneration
  const force = Boolean(providerHealth) || providerGate.changing()
  return publishProbe(await loadProviderProbe(providerHealth), force, generation)
}

async function publishProbe(probe: RuntimeProbe, force: boolean, generation: number): Promise<ManagedRuntimeSnapshot> {
  const next = await probeRuntime(probe)
  if (generation !== refreshGeneration || preparePromise && !force) return state.get()
  state.set({ ...next, activity: activeUses ? 'in_use' : 'idle' })
  return state.get()
}

async function prepare(mode: ManagedRuntimePrepareMode, model?: string): Promise<ManagedRuntimeSnapshot> {
  if (providerGate.changing()) return state.get()
  const generation = providerGate.generation()
  if (!preparePromise) {
    prepareModel = validateModel(model)
    preparePromise = runPrepare(mode, prepareModel, generation)
  }
  const current = preparePromise
  try { return await current } finally { clearPrepare(current) }
}

function clearPrepare(current: Promise<ManagedRuntimeSnapshot>): void {
  if (preparePromise !== current) return
  preparePromise = null
  prepareModel = null
}

async function runPrepare(_mode: ManagedRuntimePrepareMode, model: string, generation: number): Promise<ManagedRuntimeSnapshot> {
  try {
    if (!state.get().supported) throw new Error('Managed Runtime is only supported on macOS')
    if (!setPrepareOperation(generation, 'checking', 'Checking Managed Runtime')) return state.get()
    if (!await prepareAssets(model, generation)) return state.get()
    if (!setPrepareOperation(generation, 'saving_config', 'Saving Managed Runtime configuration')) return state.get()
    if (!await saveManagedConfigFor(generation, MANAGED_LLAMACPP_ENDPOINT, model)) return state.get()
    return refreshPreparedConfig(generation)
  } catch (error) {
    if (providerGate.current(generation)) state.set(runtimeErrorSnapshot(error, state.get().operation, state.get()))
    return state.get()
  }
}

function prepareAssets(model: string, generation: number): Promise<boolean> {
  return prepareManagedAssets(model, {
    current: () => providerGate.current(generation),
    stage: (message, extra) => setPrepareOperation(generation, 'pulling_model', message, extra),
    progress: (fallback, progress) => publishProgress(model, generation, fallback, progress),
  })
}

function publishProgress(model: string, generation: number, fallback: string, progress: PrepareProgress): void {
  if (!providerGate.current(generation)) return
  const value = typeof progress.progress === 'number' ? progress.progress : state.get().progress
  setOperation('pulling_model', progress.message || fallback, { model, pullStage: progress.pullStage, ...(typeof value === 'number' ? { progress: value } : {}) })
}

async function usingRuntime<T>(capabilities: ManagedRuntimeCapability[], work: (scope: RuntimeScope) => Promise<T>): Promise<T> {
  const generation = providerGate.generation()
  const snapshot = await refreshStatus()
  assertCapabilities(snapshot, capabilities)
  const lease = capabilities.includes('summarization') ? await acquireRuntimeLease() : null
  activeUses += 1
  publishActivity('in_use', lease?.endpoint)
  try {
    const saved = !lease || await saveManagedConfigFor(generation, lease.endpoint, snapshot.model)
    if (!saved) throw new Error('Summary provider changed before Local AI processing started. Retry with current provider.')
    return await work({ endpoint: lease?.endpoint ?? snapshot.endpoint })
  } finally {
    activeUses -= 1
    await releaseUse(lease)
  }
}

async function acquireRuntimeLease(): Promise<ManagedLlamaCppLease> {
  try { return await acquireManagedLlamaCpp() }
  catch (error) {
    state.set(runtimeErrorSnapshot(error, 'starting_runtime', state.get()))
    throw error
  }
}

function assertCapabilities(snapshot: ManagedRuntimeSnapshot, capabilities: ManagedRuntimeCapability[]): void {
  const missing = capabilities.find((name) => snapshot.capabilities[name].readiness !== 'ready')
  if (missing) throw new Error(snapshot.capabilities[missing].message || `${missing} is unavailable`)
}

async function releaseUse(lease: ManagedLlamaCppLease | null): Promise<void> {
  if (lease) await lease.release()
  activeUses = Math.max(0, activeUses)
  if (state.get().activity !== 'closing') publishActivity(activeUses ? 'in_use' : 'idle')
}

async function closeRuntime(): Promise<void> {
  state.set({ ...state.get(), activity: 'closing' })
  await stopManagedLlamaCpp()
}

function publishActivity(activity: ManagedRuntimeSnapshot['activity'], endpoint = state.get().endpoint): void {
  state.set({ ...state.get(), activity, endpoint, running: activity === 'in_use' })
}

function setOperation(operation: ManagedRuntimeSnapshot['operation'], message: string, extra: Partial<ManagedRuntimeSnapshot> = {}): void {
  state.set({ ...baseSnapshot(operation, message), ...state.get(), operation, message, ...extra, activity: activeUses ? 'in_use' : 'idle' })
}

function setPrepareOperation(generation: number, operation: ManagedRuntimeSnapshot['operation'], message: string, extra: Partial<ManagedRuntimeSnapshot> = {}): boolean {
  if (!providerGate.current(generation)) return false
  setOperation(operation, message, extra)
  return true
}

async function beginProviderChange(): Promise<RuntimeProviderChange> {
  const active = { prepare: preparePromise, model: prepareModel }
  refreshGeneration += 1
  const gate = await providerGate.beginChange()
  return { gate, ...active }
}

function endProviderChange(change: RuntimeProviderChange, resumeRepair: boolean): void {
  providerGate.endChange(change.gate)
  if (!resumeRepair) return
  const context = { generation: change.gate.generation, prepare: change.prepare, model: change.model }
  const hooks = { current: (generation: number) => providerGate.current(generation), refresh: refreshStatus, prepare: (model: string) => { void prepare('repair', model) } }
  void resumeManagedRepair(context, hooks).catch(() => undefined)
}

async function refreshPreparedConfig(providerGeneration: number): Promise<ManagedRuntimeSnapshot> {
  if (!providerGate.current(providerGeneration)) return state.get()
  const generation = ++refreshGeneration
  return publishProbe(await loadProviderProbe(), true, generation)
}

async function saveManagedConfigFor(generation: number, endpoint: string, model: string): Promise<boolean> {
  return providerGate.runSave(generation, async () => {
    await requestCommand('config.useManagedLocalAI', { endpoint, model })
  })
}

function validateModel(model?: string): string {
  const selected = model || MANAGED_LLAMACPP_MODEL
  if (isManagedLlamaCppModel(selected)) return selected
  throw new Error(`Unsupported Local AI model "${selected}". Choose one of: ${MANAGED_LLAMACPP_MODEL_OPTIONS.map((item) => item.tag).join(', ')}.`)
}
