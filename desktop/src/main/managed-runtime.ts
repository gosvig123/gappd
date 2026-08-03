import type { AIConfig } from '../shared/generated/contracts'
import type { ManagedRuntimeCapability, ManagedRuntimePrepareMode, ManagedRuntimePullStage, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { LOCAL_AI_PROVIDER_LLAMACPP, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_MODEL, MANAGED_LLAMACPP_MODEL_OPTIONS, isManagedLlamaCppModel } from '../shared/managed-local-ai'
import { requestCommand } from './app-protocol'
import { ensureAppleSpeechAsset } from './apple-speech'
import { ensureManagedLanguageModel } from './language-model'
import { acquireManagedLlamaCpp, stopManagedLlamaCpp, type ManagedLlamaCppLease } from './llamacpp'
import { createObservableState } from './observable-state'
import { baseSnapshot, initialRuntimeSnapshot, probeRuntime, runtimeErrorSnapshot, type RuntimeProbe } from './managed-runtime-status'

export type RuntimeScope = { endpoint: string }
export type ManagedRuntime = {
  status(): ManagedRuntimeSnapshot
  observe(listener: (snapshot: ManagedRuntimeSnapshot) => void): () => void
  prepare(mode: ManagedRuntimePrepareMode, model?: string): Promise<ManagedRuntimeSnapshot>
  using<T>(capabilities: ManagedRuntimeCapability[], work: (scope: RuntimeScope) => Promise<T>): Promise<T>
  close(): Promise<void>
}

type Progress = { progress?: number; message?: string; pullStage?: ManagedRuntimePullStage }
const state = createObservableState<ManagedRuntimeSnapshot>(initialRuntimeSnapshot())
let preparePromise: Promise<ManagedRuntimeSnapshot> | null = null
let activeUses = 0

export const managedRuntime: ManagedRuntime = {
  status: state.get,
  observe: state.subscribe,
  prepare,
  using: usingRuntime,
  close: closeRuntime,
}

export async function bootstrapManagedRuntime(): Promise<void> {
  const probe = await loadConfig()
  const snapshot = await publishProbe(probe)
  if (probe.config?.provider === LOCAL_AI_PROVIDER_LLAMACPP && probe.config.managed && snapshot.operation !== 'ready') void prepare('repair', probe.config.model)
}

async function refreshStatus(): Promise<ManagedRuntimeSnapshot> {
  if (preparePromise) return state.get()
  return publishProbe(await loadConfig())
}

async function publishProbe(probe: RuntimeProbe, force = false): Promise<ManagedRuntimeSnapshot> {
  const next = await probeRuntime(probe)
  if (preparePromise && !force) return state.get()
  state.set({ ...next, activity: activeUses ? 'in_use' : 'idle' })
  return state.get()
}

async function prepare(mode: ManagedRuntimePrepareMode, model?: string): Promise<ManagedRuntimeSnapshot> {
  if (!preparePromise) preparePromise = runPrepare(mode, validateModel(model))
  try { return await preparePromise } finally { preparePromise = null }
}

async function runPrepare(_mode: ManagedRuntimePrepareMode, model: string): Promise<ManagedRuntimeSnapshot> {
  try {
    if (!state.get().supported) throw new Error('Managed Runtime is only supported on macOS')
    setOperation('checking', 'Checking Managed Runtime')
    await prepareLanguageModel(model)
    await prepareSpeech(model)
    setOperation('saving_config', 'Saving Managed Runtime configuration')
    await saveManagedConfig(MANAGED_LLAMACPP_ENDPOINT, model)
    return publishProbe(await loadConfig(), true)
  } catch (error) {
    state.set(runtimeErrorSnapshot(error, state.get().operation, state.get()))
    return state.get()
  }
}

async function prepareLanguageModel(model: string): Promise<void> {
  setOperation('pulling_model', `Downloading meeting model ${model}`, { pullStage: 'preparing' })
  await ensureManagedLanguageModel((progress) => publishProgress(model, `Downloading meeting model ${model}`, progress))
}

async function prepareSpeech(model: string): Promise<void> {
  setOperation('pulling_model', 'Preparing Apple speech model', { model, pullStage: 'preparing', progress: undefined })
  await ensureAppleSpeechAsset((progress) => publishProgress(model, 'Downloading Apple speech model', progress))
}

function publishProgress(model: string, fallback: string, progress: Progress): void {
  const value = typeof progress.progress === 'number' ? progress.progress : state.get().progress
  setOperation('pulling_model', progress.message || fallback, { model, pullStage: progress.pullStage, ...(typeof value === 'number' ? { progress: value } : {}) })
}

async function usingRuntime<T>(capabilities: ManagedRuntimeCapability[], work: (scope: RuntimeScope) => Promise<T>): Promise<T> {
  const snapshot = await refreshStatus()
  assertCapabilities(snapshot, capabilities)
  const lease = capabilities.includes('summarization') ? await acquireRuntimeLease() : null
  activeUses += 1
  publishActivity('in_use', lease?.endpoint)
  try {
    if (lease) await saveManagedConfig(lease.endpoint, snapshot.model)
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

async function loadConfig(): Promise<RuntimeProbe> {
  try { return { config: (await requestCommand('config.show', {})).ai } }
  catch (error) { return { config: null, error: error instanceof Error ? error.message : String(error) } }
}

async function saveManagedConfig(endpoint: string, model: string): Promise<AIConfig> {
  return (await requestCommand('config.useManagedLocalAI', { endpoint, model })).ai
}

function validateModel(model?: string): string {
  const selected = model || MANAGED_LLAMACPP_MODEL
  if (isManagedLlamaCppModel(selected)) return selected
  throw new Error(`Unsupported Local AI model "${selected}". Choose one of: ${MANAGED_LLAMACPP_MODEL_OPTIONS.map((item) => item.tag).join(', ')}.`)
}
