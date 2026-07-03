import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus, type LocalAISetupPullStage, type LocalAISetupStatus } from '../shared/contracts'
import { MANAGED_LLAMACPP_MODEL, MANAGED_LLAMACPP_MODEL_OPTIONS, isManagedLlamaCppModel } from '../shared/managed-local-ai'
import type { LocalAISetupInput } from '../shared/ipc-contract'
import { getLocalAIConfig, saveManagedLocalAIConfig } from './gappd'
import { ensureManagedLanguageModel, managedLanguageModelAvailable, missingManagedLanguageModelMessage } from './language-model'
import { ensureManagedLlamaCppRunning, managedLlamaCppSupported } from './llamacpp'
import { createObservableState } from './observable-state'
import { bundledWhisperAvailable, ensureManagedWhisperModel, managedWhisperModelAvailable, missingBundledWhisperMessage, missingManagedWhisperModelMessage } from './whisper'
import { errorStatus, localAISetupStatusFrom, localAIStatusFrom, managedModelStatus, managedStatus, needsSetupStatus } from './local-ai-status'
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
  if (result.error) return void setBootstrapStatus(runId, errorStatus(result.error, getLocalAISetupStatus().phase))
  if (!result.config) return void setBootstrapStatus(runId, needsSetupStatus())
  if (!isManagedLocalAIConfigured(result.config)) return void setBootstrapStatus(runId, externalConfigStatus(result.config))
  await bootstrapManagedLlamaCppConfig(runId, result.config)
}

async function bootstrapManagedLlamaCppConfig(runId: number, config: LocalAIConfig): Promise<void> {
  try {
    if (!(await managedLanguageModelAvailable(config.model))) return void setBootstrapStatus(runId, missingLanguageModelStatus(config.endpoint, config.model))
    if (!setBootstrapStatus(runId, managedStatus('starting_runtime', 'Starting managed llama.cpp', { endpoint: config.endpoint, model: config.model }))) return
    const endpoint = await ensureManagedLlamaCppRunning()
    await saveManagedEndpoint(config, endpoint)
    await publishLlamaCppReadiness(runId, config.model, endpoint)
  } catch (error) {
    setBootstrapStatus(runId, errorStatus(error, getLocalAISetupStatus().phase, config.model))
  }
}

async function publishLlamaCppReadiness(runId: number, model: string, endpoint: string): Promise<void> {
  if (!(await managedLanguageModelAvailable(model))) return void setBootstrapStatus(runId, missingLanguageModelStatus(endpoint, model))
  if (!(await bundledWhisperAvailable())) return void setBootstrapStatus(runId, errorStatus(missingBundledWhisperMessage(), 'checking', model))
  if (!(await managedWhisperModelAvailable())) return void setBootstrapStatus(runId, missingWhisperStatus(endpoint, model))
  setBootstrapStatus(runId, managedStatus('ready', 'Managed llama.cpp is ready', { endpoint, model }))
}

async function runSetupSingleFlight(model: string): Promise<LocalAISetupStatus> {
  if (!setupPromise) { setupRunId += 1; setupPromise = runSetup(model) }
  try { return await setupPromise } finally { setupPromise = null }
}

async function runSetup(model: string): Promise<LocalAISetupStatus> {
  if (!managedLlamaCppSupported()) return unsupportedStatus(model)
  try { await runManagedLlamaCppSetup(model) } catch (error) { setStatus(errorStatus(error, getLocalAISetupStatus().phase, model)) }
  return getLocalAISetupStatus()
}

async function runManagedLlamaCppSetup(model: string): Promise<void> {
  setStatus(managedModelStatus(model, 'checking', 'Checking managed llama.cpp'))
  await downloadLanguageModel(model)
  const endpoint = await startLlamaCpp(model)
  await downloadWhisperModel(model, endpoint)
  setStatus(managedModelStatus(model, 'saving_config', 'Saving local AI configuration', { endpoint }))
  const config = await saveManagedLocalAIConfig({ endpoint, model })
  setStatus(managedStatus('ready', 'Local AI is ready', { endpoint: config.endpoint, model: config.model }))
}

async function downloadLanguageModel(model: string): Promise<void> {
  setStatus(managedModelStatus(model, 'pulling_model', `Downloading meeting model ${model}`, { progress: undefined, pullStage: 'preparing' }))
  await ensureManagedLanguageModel((update) => setPullStatus(model, getLocalAISetupStatus().endpoint, `Downloading meeting model ${model}`, update))
}

async function startLlamaCpp(model: string): Promise<string> {
  const endpoint = await ensureManagedLlamaCppRunning()
  setStatus(managedModelStatus(model, 'starting_runtime', 'Managed llama.cpp is running', { endpoint }))
  return endpoint
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
  try { return { config: await getLocalAIConfig() } } catch (error) { return { config: null, error: error instanceof Error ? error.message : 'Failed to read local AI configuration' } }
}

async function saveManagedEndpoint(config: LocalAIConfig, endpoint: string): Promise<void> {
  if (config.endpoint === endpoint) return
  await saveManagedLocalAIConfig({ endpoint, model: config.model, temperature: config.temperature })
}

async function resolveSetupModel(input: LocalAISetupInput | undefined, preserveConfigured: boolean): Promise<string> {
  if (input?.model) return validatedSetupModel(input.model)
  if (!preserveConfigured) return MANAGED_LLAMACPP_MODEL
  const { config } = await loadLocalAIConfig()
  return configuredModel(config) ?? currentModel() ?? MANAGED_LLAMACPP_MODEL
}

function setPullStatus(model: string, endpoint: string, defaultMessage: string, update: ProgressUpdate): void {
  const progress = typeof update.progress === 'number' ? update.progress : getLocalAISetupStatus().progress
  const nextProgress = typeof progress === 'number' ? { progress } : {}
  setStatus(managedModelStatus(model, 'pulling_model', update.message || defaultMessage, { endpoint, ...nextProgress, pullStage: update.pullStage }))
}

function setBootstrapStatus(runId: number, next: LocalAISetupStatus): boolean {
  if (setupPromise || setupRunId !== runId) return false
  setStatus(next)
  return true
}

function unsupportedStatus(model: string): LocalAISetupStatus {
  setStatus(errorStatus('Managed llama.cpp Local AI setup is only supported on macOS', getLocalAISetupStatus().phase, model))
  return getLocalAISetupStatus()
}

function externalConfigStatus(config: LocalAIConfig): LocalAISetupStatus {
  return needsSetupStatus({ managed: false, endpoint: config.endpoint, model: config.model, message: 'Desktop is configured for external Local AI. Run Local AI setup to switch to the managed runtime.' })
}

function missingWhisperStatus(endpoint: string, model: string): LocalAISetupStatus {
  return needsSetupStatus({ endpoint, model, message: missingManagedWhisperModelMessage(), canRetry: true })
}

function missingLanguageModelStatus(endpoint: string, model: string): LocalAISetupStatus {
  return needsSetupStatus({ endpoint, model, message: missingManagedLanguageModelMessage(), canRetry: true })
}

function validatedSetupModel(model: string): string {
  if (isManagedLlamaCppModel(model)) return model
  throw new Error(`Unsupported local AI model "${model}". Choose one of: ${MANAGED_LLAMACPP_MODEL_OPTIONS.map((option) => option.tag).join(', ')}.`)
}

function configuredModel(config: LocalAIConfig | null): string | undefined {
  return config?.managed && isManagedLlamaCppModel(config.model) ? config.model : undefined
}

function currentModel(): string | undefined {
  const current = getLocalAISetupStatus()
  return current.managed && isManagedLlamaCppModel(current.model) ? current.model : undefined
}

const setStatus = setupState.set
