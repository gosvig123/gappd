import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus, type OnboardingStatus } from '../shared/contracts'
import { MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_MODEL } from '../shared/bundled-ollama'
import { getLocalAIConfig, saveManagedLocalAIConfig } from './gappd'
import { toOnboardingErrorState } from './onboarding-error-state'
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

let status: OnboardingStatus = needsSetupStatus()
let onboardingPromise: Promise<OnboardingStatus> | null = null
let onboardingRunId = 0
const listeners = new Set<(status: OnboardingStatus) => void>()

type LocalAIConfigLoadResult = { config: LocalAIConfig | null; error?: string }

export function getOnboardingStatus(): OnboardingStatus { return status }

export function onOnboardingStatusChange(listener: (status: OnboardingStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function bootstrapOnboarding(): Promise<void> {
  const bootstrapRunId = onboardingRunId
  if (onboardingPromise) return
  const { config, error } = await loadLocalAIConfig()
  if (error) {
    setBootstrapStatus(bootstrapRunId, errorStatus(error, status.phase))
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
    await ensureManagedOllamaRunning()
    if (!(await managedModelAvailable(config.model))) {
      setBootstrapStatus(bootstrapRunId, missingModelStatus(config.model, config.endpoint))
      return
    }
    if (!(await bundledWhisperAvailable())) {
      setBootstrapStatus(bootstrapRunId, errorStatus(missingBundledWhisperMessage(), 'checking', config.model))
      return
    }
    if (!(await managedWhisperModelAvailable())) {
      setBootstrapStatus(bootstrapRunId, needsSetupStatus({ endpoint: config.endpoint, model: config.model, message: missingManagedWhisperModelMessage(), canRetry: true }))
      return
    }
    setBootstrapStatus(bootstrapRunId, managedStatus('ready', 'Managed Ollama is ready', { endpoint: config.endpoint, model: config.model }))
  } catch (error) {
    setBootstrapStatus(bootstrapRunId, errorStatus(error, status.phase, config.model))
  }
}

export async function startOnboarding(): Promise<OnboardingStatus> { return runOnboardingSingleFlight() }

export async function retryOnboarding(): Promise<OnboardingStatus> { return runOnboardingSingleFlight() }

export async function getLocalAIStatus(): Promise<LocalAIStatus> {
  const { config, error } = await loadLocalAIConfig()
  return withWhisperReadiness(await getManagedOllamaStatus(config, error))
}

export async function repairLocalAI(): Promise<LocalAIStatus> {
  const next = await runOnboardingSingleFlight()
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

async function runOnboardingSingleFlight(): Promise<OnboardingStatus> {
  if (!onboardingPromise) {
    onboardingRunId += 1
    onboardingPromise = runOnboarding()
  }
  try {
    return await onboardingPromise
  } finally {
    onboardingPromise = null
  }
}

async function runOnboarding(): Promise<OnboardingStatus> {
  if (!managedOllamaSupported()) {
    setStatus(errorStatus('Managed Ollama onboarding is only supported on macOS', status.phase))
    return status
  }
  try {
    setStatus(managedStatus('checking', 'Checking managed Ollama'))
    await ensureManagedOllamaRunning()
    setStatus(managedStatus('starting_ollama', 'Managed Ollama is running'))
    setStatus(managedStatus('pulling_model', 'Pulling local model'))
    await pullManagedModel(({ progress, message, pullStage }) => {
      const nextProgress = typeof progress === 'number' ? progress : status.progress
      const nextStatus = typeof nextProgress === 'number' ? { progress: nextProgress } : {}
      setStatus(managedStatus('pulling_model', message || 'Pulling local model', { ...nextStatus, pullStage }))
    })
    setStatus(managedStatus('pulling_model', 'Preparing speech model download', { progress: undefined, pullStage: 'preparing' }))
    await ensureManagedWhisperModel(({ progress, message, pullStage }) => {
      const nextProgress = typeof progress === 'number' ? progress : status.progress
      const nextStatus = typeof nextProgress === 'number' ? { progress: nextProgress } : {}
      setStatus(managedStatus('pulling_model', message || 'Downloading speech model', { ...nextStatus, pullStage }))
    })
    setStatus(managedStatus('saving_config', 'Saving local AI configuration'))
    const config = await saveManagedLocalAIConfig({ endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL })
    setStatus(managedStatus('ready', 'Local AI is ready', { endpoint: config.endpoint, model: config.model }))
  } catch (error) {
    setStatus(errorStatus(error, status.phase, MANAGED_OLLAMA_MODEL))
  }
  return status
}

async function loadLocalAIConfig(): Promise<LocalAIConfigLoadResult> {
  try {
    return { config: await getLocalAIConfig() }
  } catch (error) {
    return { config: null, error: error instanceof Error ? error.message : 'Failed to read local AI configuration' }
  }
}

function setStatus(next: OnboardingStatus): void {
  status = next
  for (const listener of listeners) listener(status)
}

function setBootstrapStatus(runId: number, next: OnboardingStatus): boolean {
  if (onboardingPromise || onboardingRunId !== runId) return false
  setStatus(next)
  return true
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
