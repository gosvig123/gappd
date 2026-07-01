import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus, type LocalAISetupPullStage, type LocalAISetupStatus } from '../shared/contracts'
import { MANAGED_OLLAMA_MODEL, MANAGED_OLLAMA_MODEL_OPTIONS, isManagedOllamaModel } from '../shared/bundled-ollama'
import type { LocalAISetupInput } from '../shared/ipc-contract'
import { getLocalAIConfig, saveManagedLocalAIConfig } from './gappd'
import { createObservableState } from './observable-state'
import { ensureManagedOllamaRunning, managedModelAvailable, managedOllamaSupported, pullManagedModel } from './ollama'
import { bundledWhisperAvailable, ensureManagedWhisperModel, managedWhisperModelAvailable, missingBundledWhisperMessage, missingManagedWhisperModelMessage } from './whisper'
import { errorStatus, localAIStatusFrom, managedModelStatus, managedStatus, missingModelStatus, needsSetupStatus, localAISetupStatusFrom } from './local-ai-status'
import { runtimeLocalAIStatus } from './local-ai-runtime-status'

type ConfigLoadResult = { config: LocalAIConfig | null; error?: string }
type ProgressUpdate = { progress?: number; message?: string; pullStage?: LocalAISetupPullStage }
export type LocalAISetupOptions = { preserveConfigured?: boolean }

const setupState = createObservableState<LocalAISetupStatus>(needsSetupStatus())
let setupPromise: Promise<LocalAISetupStatus> | null = null
let setupRunId = 0

export const getLocalAISetupStatus = setupState.get
export const onLocalAISetupStatusChange = setupState.subscribe

export async function bootstrapLocalAISetup(): Promise<void> {
  if (setupPromise) return
  await bootstrapFromConfig(setupRunId, await loadLocalAIConfig())
}

export async function startLocalAISetup(input?: LocalAISetupInput, options: LocalAISetupOptions = {}): Promise<LocalAISetupStatus> {
  return runSetupSingleFlight(await resolveSetupModel(input, Boolean(options.preserveConfigured)))
}

export async function retryLocalAISetup(input?: LocalAISetupInput): Promise<LocalAISetupStatus> {
  return startLocalAISetup(input, { preserveConfigured: true })
}

export async function getLocalAISetupStatusSnapshot(): Promise<LocalAIStatus> {
  return localAIStatusFor(getLocalAISetupStatus(), true)
}

export async function repairLocalAISetup(): Promise<LocalAIStatus> {
  return localAIStatusFor(await runSetupSingleFlight(await resolveSetupModel(undefined, true)), false)
}

async function bootstrapFromConfig(runId: number, result: ConfigLoadResult): Promise<void> {
  if (result.error) {
    setBootstrapStatus(runId, errorStatus(result.error, getLocalAISetupStatus().phase))
    return
  }
  if (!result.config) {
    setBootstrapStatus(runId, needsSetupStatus())
    return
  }
  if (!isManagedLocalAIConfigured(result.config)) {
    setBootstrapStatus(runId, externalConfigStatus(result.config))
    return
  }
  await bootstrapManagedConfig(runId, result.config)
}

async function bootstrapManagedConfig(runId: number, config: LocalAIConfig): Promise<void> {
  try {
    if (!setBootstrapStatus(runId, managedStatus('starting_ollama', 'Starting managed Ollama', { endpoint: config.endpoint, model: config.model }))) return
    const endpoint = await ensureManagedOllamaRunning()
    await saveManagedEndpoint(config, endpoint)
    await publishBootstrapReadiness(runId, config.model, endpoint)
  } catch (error) {
    setBootstrapStatus(runId, errorStatus(error, getLocalAISetupStatus().phase, config.model))
  }
}

async function publishBootstrapReadiness(runId: number, model: string, endpoint: string): Promise<void> {
  if (!(await managedModelAvailable(model, endpoint))) {
    setBootstrapStatus(runId, missingModelStatus(model, endpoint))
    return
  }
  if (!(await bundledWhisperAvailable())) {
    setBootstrapStatus(runId, errorStatus(missingBundledWhisperMessage(), 'checking', model))
    return
  }
  if (!(await managedWhisperModelAvailable())) {
    setBootstrapStatus(runId, missingWhisperStatus(endpoint, model))
    return
  }
  setBootstrapStatus(runId, managedStatus('ready', 'Managed Ollama is ready', { endpoint, model }))
}

async function runSetupSingleFlight(model: string): Promise<LocalAISetupStatus> {
  if (!setupPromise) {
    setupRunId += 1
    setupPromise = runSetup(model)
  }
  try {
    return await setupPromise
  } finally {
    setupPromise = null
  }
}

async function runSetup(model: string): Promise<LocalAISetupStatus> {
  if (!managedOllamaSupported()) return unsupportedStatus(model)
  try {
    await runManagedSetup(model)
  } catch (error) {
    setStatus(errorStatus(error, getLocalAISetupStatus().phase, model))
  }
  return getLocalAISetupStatus()
}

async function runManagedSetup(model: string): Promise<void> {
  setStatus(managedModelStatus(model, 'checking', 'Checking managed Ollama'))
  const endpoint = await ensureManagedOllamaRunning()
  setStatus(managedModelStatus(model, 'starting_ollama', 'Managed Ollama is running', { endpoint }))
  await pullOllamaModel(model, endpoint)
  await downloadWhisperModel(model, endpoint)
  setStatus(managedModelStatus(model, 'saving_config', 'Saving local AI configuration', { endpoint }))
  const config = await saveManagedLocalAIConfig({ endpoint, model })
  setStatus(managedStatus('ready', 'Local AI is ready', { endpoint: config.endpoint, model: config.model }))
}

async function pullOllamaModel(model: string, endpoint: string): Promise<void> {
  setStatus(managedModelStatus(model, 'pulling_model', `Pulling local model ${model}`, { endpoint }))
  await pullManagedModel(model, (update) => setPullStatus(model, endpoint, `Pulling local model ${model}`, update), endpoint)
}

async function downloadWhisperModel(model: string, endpoint: string): Promise<void> {
  setStatus(managedModelStatus(model, 'pulling_model', 'Preparing speech model download', { endpoint, progress: undefined, pullStage: 'preparing' }))
  await ensureManagedWhisperModel((update) => setPullStatus(model, endpoint, 'Downloading speech model', update))
}

async function localAIStatusFor(operation: LocalAISetupStatus, refreshOperation: boolean): Promise<LocalAIStatus> {
  const runtime = await runtimeLocalAIStatus(await loadLocalAIConfig())
  if (refreshOperation && !setupPromise) setStatus(localAISetupStatusFrom(runtime))
  const status = refreshOperation && !setupPromise ? getLocalAISetupStatus() : operation
  return localAIStatusFrom(runtime, status)
}

async function loadLocalAIConfig(): Promise<ConfigLoadResult> {
  try {
    return { config: await getLocalAIConfig() }
  } catch (error) {
    return { config: null, error: error instanceof Error ? error.message : 'Failed to read local AI configuration' }
  }
}

async function saveManagedEndpoint(config: LocalAIConfig, endpoint: string): Promise<void> {
  if (config.endpoint === endpoint) return
  await saveManagedLocalAIConfig({ endpoint, model: config.model, temperature: config.temperature })
}

async function resolveSetupModel(input: LocalAISetupInput | undefined, preserveConfigured: boolean): Promise<string> {
  if (input?.model) return validatedSetupModel(input.model)
  if (!preserveConfigured) return MANAGED_OLLAMA_MODEL
  const { config } = await loadLocalAIConfig()
  return configuredModel(config) ?? currentModel() ?? MANAGED_OLLAMA_MODEL
}

function setPullStatus(model: string, endpoint: string, fallback: string, update: ProgressUpdate): void {
  const progress = typeof update.progress === 'number' ? update.progress : getLocalAISetupStatus().progress
  const nextProgress = typeof progress === 'number' ? { progress } : {}
  setStatus(managedModelStatus(model, 'pulling_model', update.message || fallback, { endpoint, ...nextProgress, pullStage: update.pullStage }))
}

function setBootstrapStatus(runId: number, next: LocalAISetupStatus): boolean {
  if (setupPromise || setupRunId !== runId) return false
  setStatus(next)
  return true
}

function unsupportedStatus(model: string): LocalAISetupStatus {
  setStatus(errorStatus('Managed Ollama Local AI setup is only supported on macOS', getLocalAISetupStatus().phase, model))
  return getLocalAISetupStatus()
}

function externalConfigStatus(config: LocalAIConfig): LocalAISetupStatus {
  return needsSetupStatus({ managed: false, endpoint: config.endpoint, model: config.model, message: 'Desktop is configured for external Ollama. Run Local AI setup to switch to the managed runtime.' })
}

function missingWhisperStatus(endpoint: string, model: string): LocalAISetupStatus {
  return needsSetupStatus({ endpoint, model, message: missingManagedWhisperModelMessage(), canRetry: true })
}

function validatedSetupModel(model: string): string {
  if (isManagedOllamaModel(model)) return model
  throw new Error(`Unsupported local AI model "${model}". Choose one of: ${MANAGED_OLLAMA_MODEL_OPTIONS.map((option) => option.tag).join(', ')}.`)
}

function configuredModel(config: LocalAIConfig | null): string | undefined {
  return config?.managed && config.model ? config.model : undefined
}

function currentModel(): string | undefined {
  const current = getLocalAISetupStatus()
  return current.managed && current.model ? current.model : undefined
}

const setStatus = setupState.set
