import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus, type OnboardingStatus } from '../shared/contracts'
import { MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_MODEL, MANAGED_OLLAMA_MODEL_OPTIONS, isManagedOllamaModel } from '../shared/bundled-ollama'
import type { OnboardingSetupInput } from '../shared/ipc-contract'
import { getLocalAIConfig, saveManagedLocalAIConfig } from './gappd'
import { createObservableState } from './observable-state'
import { toOnboardingErrorState } from './onboarding-errors'
import {
  ensureManagedOllamaRunning,
  getManagedOllamaStatus,
  managedModelAvailable,
  managedOllamaSupported,
  pullManagedModel,
} from './ollama'
import {
  bundledWhisperAvailable,
  ensureManagedWhisperModel,
  managedWhisperModelAvailable,
  missingBundledWhisperMessage,
  missingManagedWhisperModelMessage,
} from './whisper'

const onboardingState = createObservableState<OnboardingStatus>(needsSetupStatus())
let onboardingPromise: Promise<OnboardingStatus> | null = null
let onboardingRunId = 0

type LocalAIConfigLoadResult = { config: LocalAIConfig | null; error?: string }

export const getOnboardingStatus = onboardingState.get
export const onOnboardingStatusChange = onboardingState.subscribe

export async function bootstrapOnboarding(): Promise<void> {
  const bootstrapRunId = onboardingRunId
  if (onboardingPromise) return
  const { config, error } = await loadLocalAIConfig()
  if (error) {
    setBootstrapStatus(bootstrapRunId, errorStatus(error, getOnboardingStatus().phase))
    return
  }
  if (!config) {
    setBootstrapStatus(bootstrapRunId, needsSetupStatus())
    return
  }
  if (!isManagedLocalAIConfigured(config)) {
    setBootstrapStatus(bootstrapRunId, needsSetupStatus({
      managed: false,
      endpoint: config.endpoint,
      model: config.model,
      message: 'Desktop is configured for external Ollama. Run setup to switch to the managed runtime.',
    }))
    return
  }
  try {
    if (!setBootstrapStatus(bootstrapRunId, managedStatus('starting_ollama', 'Starting managed Ollama', { endpoint: config.endpoint, model: config.model }))) return
    const endpoint = await ensureManagedOllamaRunning()
    await saveManagedEndpoint(config, endpoint)
    if (!(await managedModelAvailable(config.model, endpoint))) {
      setBootstrapStatus(bootstrapRunId, missingModelStatus(config.model, endpoint))
      return
    }
    if (!(await bundledWhisperAvailable())) {
      setBootstrapStatus(bootstrapRunId, errorStatus(missingBundledWhisperMessage(), 'checking', config.model))
      return
    }
    if (!(await managedWhisperModelAvailable())) {
      setBootstrapStatus(bootstrapRunId, needsSetupStatus({ endpoint, model: config.model, message: missingManagedWhisperModelMessage(), canRetry: true }))
      return
    }
    setBootstrapStatus(bootstrapRunId, managedStatus('ready', 'Managed Ollama is ready', { endpoint, model: config.model }))
  } catch (error) {
    setBootstrapStatus(bootstrapRunId, errorStatus(error, getOnboardingStatus().phase, config.model))
  }
}

type OnboardingRunOptions = { preserveConfigured?: boolean }

export async function startOnboarding(input?: OnboardingSetupInput, options: OnboardingRunOptions = {}): Promise<OnboardingStatus> {
  return runOnboardingSingleFlight(await resolveSetupModel(input, Boolean(options.preserveConfigured)))
}

export async function retryOnboarding(input?: OnboardingSetupInput): Promise<OnboardingStatus> {
  return startOnboarding(input, { preserveConfigured: true })
}

export async function getLocalAIStatus(): Promise<LocalAIStatus> {
  const { config, error } = await loadLocalAIConfig()
  return withWhisperReadiness(await getManagedOllamaStatus(config, error))
}

export async function repairLocalAI(): Promise<LocalAIStatus> {
  const next = await runOnboardingSingleFlight(await resolveSetupModel(undefined, true))
  return {
    ...(await getLocalAIStatus()),
    phase: next.phase,
    message: next.message,
    progress: next.progress,
    error: next.error,
    errorDetail: next.errorDetail,
    debugDetail: next.debugDetail,
    errorDebug: next.errorDebug,
    pullStage: next.pullStage,
    errorKind: next.errorKind,
    ownershipConflict: next.ownershipConflict,
    canRetry: next.canRetry,
  }
}

async function runOnboardingSingleFlight(model: string): Promise<OnboardingStatus> {
  if (!onboardingPromise) {
    onboardingRunId += 1
    onboardingPromise = runOnboarding(model)
  }
  try {
    return await onboardingPromise
  } finally {
    onboardingPromise = null
  }
}

async function runOnboarding(model: string): Promise<OnboardingStatus> {
  if (!managedOllamaSupported()) {
    setStatus(errorStatus('Managed Ollama onboarding is only supported on macOS', getOnboardingStatus().phase, model))
    return getOnboardingStatus()
  }
  try {
    setStatus(managedModelStatus(model, 'checking', 'Checking managed Ollama'))
    const endpoint = await ensureManagedOllamaRunning()
    setStatus(managedModelStatus(model, 'starting_ollama', 'Managed Ollama is running', { endpoint }))
    setStatus(managedModelStatus(model, 'pulling_model', `Pulling local model ${model}`, { endpoint }))
    await pullManagedModel(model, ({ progress, message, pullStage }) => {
      const nextProgress = typeof progress === 'number' ? progress : getOnboardingStatus().progress
      const nextStatus = typeof nextProgress === 'number' ? { progress: nextProgress } : {}
      setStatus(managedModelStatus(model, 'pulling_model', message || `Pulling local model ${model}`, { endpoint, ...nextStatus, pullStage }))
    }, endpoint)
    setStatus(managedModelStatus(model, 'pulling_model', 'Preparing speech model download', { endpoint, progress: undefined, pullStage: 'preparing' }))
    await ensureManagedWhisperModel(({ progress, message, pullStage }) => {
      const nextProgress = typeof progress === 'number' ? progress : getOnboardingStatus().progress
      const nextStatus = typeof nextProgress === 'number' ? { progress: nextProgress } : {}
      setStatus(managedModelStatus(model, 'pulling_model', message || 'Downloading speech model', { endpoint, ...nextStatus, pullStage }))
    })
    setStatus(managedModelStatus(model, 'saving_config', 'Saving local AI configuration', { endpoint }))
    const config = await saveManagedLocalAIConfig({ endpoint, model })
    setStatus(managedStatus('ready', 'Local AI is ready', { endpoint: config.endpoint, model: config.model }))
  } catch (error) {
    setStatus(errorStatus(error, getOnboardingStatus().phase, model))
  }
  return getOnboardingStatus()
}

async function loadLocalAIConfig(): Promise<LocalAIConfigLoadResult> {
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

const setStatus = onboardingState.set

function setBootstrapStatus(runId: number, next: OnboardingStatus): boolean {
  if (onboardingPromise || onboardingRunId !== runId) return false
  setStatus(next)
  return true
}

async function resolveSetupModel(input: OnboardingSetupInput | undefined, preserveConfigured: boolean): Promise<string> {
  if (input?.model) return validatedSetupModel(input.model)
  if (!preserveConfigured) return MANAGED_OLLAMA_MODEL
  const { config } = await loadLocalAIConfig()
  const current = getOnboardingStatus()
  return config?.managed && config.model ? config.model : current.managed && current.model ? current.model : MANAGED_OLLAMA_MODEL
}

function validatedSetupModel(model: string): string {
  if (isManagedOllamaModel(model)) return model
  const options = MANAGED_OLLAMA_MODEL_OPTIONS.map((option) => option.tag).join(', ')
  throw new Error(`Unsupported local AI model "${model}". Choose one of: ${options}.`)
}

function managedModelStatus(model: string, phase: OnboardingStatus['phase'], message: string, overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return managedStatus(phase, message, { model, ...overrides })
}

function needsSetupStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return { phase: 'needs_setup', managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL, message: 'Local AI setup is required', canRetry: false, ...overrides }
}

function managedStatus(phase: OnboardingStatus['phase'], message: string, overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return { phase, managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL, message, canRetry: false, ...overrides }
}

function missingModelStatus(model: string, endpoint = MANAGED_OLLAMA_ENDPOINT): OnboardingStatus {
  return { phase: 'needs_setup', managed: true, endpoint, model, message: `Managed Ollama is running, but model ${model} is missing. Run setup to pull it again.`, canRetry: true }
}

async function withWhisperReadiness(next: LocalAIStatus): Promise<LocalAIStatus> {
  if (!next.bundled) return next
  if (!(await bundledWhisperAvailable())) return whisperRuntimeMissingStatus(next)
  if (next.phase === 'ready' && !(await managedWhisperModelAvailable())) return whisperModelMissingStatus(next)
  return next
}

function whisperRuntimeMissingStatus(next: LocalAIStatus): LocalAIStatus {
  const error = missingBundledWhisperMessage()
  return { ...next, phase: 'error', message: error, error, errorKind: 'runtime', bundled: false, canRepair: false }
}

function whisperModelMissingStatus(next: LocalAIStatus): LocalAIStatus {
  return { ...next, phase: 'needs_setup', message: missingManagedWhisperModelMessage(), canRetry: true }
}

function errorStatus(error: unknown, phase: OnboardingStatus['phase'], model = MANAGED_OLLAMA_MODEL): OnboardingStatus {
  const nextError = toOnboardingErrorState(error, phase, fallbackOnboardingError(phase))
  return { phase: 'error', managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model, message: nextError.error, ...nextError, canRetry: true }
}

function fallbackOnboardingError(phase: OnboardingStatus['phase']): string {
  return phase === 'pulling_model'
    ? 'Local model download failed. Check your network connection, then retry Local AI setup.'
    : 'Managed Ollama onboarding failed'
}
