import { MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_MODEL } from '../shared/bundled-ollama'
import type { LocalAIStatus, LocalAISetupStatus } from '../shared/contracts'
import { toLocalAISetupErrorState } from './local-ai-setup-errors'

export function needsSetupStatus(overrides: Partial<LocalAISetupStatus> = {}): LocalAISetupStatus {
  return { phase: 'needs_setup', managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL, message: 'Local AI setup is required', canRetry: false, ...overrides }
}

export function managedStatus(phase: LocalAISetupStatus['phase'], message: string, overrides: Partial<LocalAISetupStatus> = {}): LocalAISetupStatus {
  return { phase, managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL, message, canRetry: false, ...overrides }
}

export function managedModelStatus(model: string, phase: LocalAISetupStatus['phase'], message: string, overrides: Partial<LocalAISetupStatus> = {}): LocalAISetupStatus {
  return managedStatus(phase, message, { model, ...overrides })
}

export function missingModelStatus(model: string, endpoint = MANAGED_OLLAMA_ENDPOINT): LocalAISetupStatus {
  return needsSetupStatus({ endpoint, model, message: `Managed Ollama is running, but model ${model} is missing. Run Local AI setup to pull it again.`, canRetry: true })
}

export function localAIStatusFrom(runtime: LocalAIStatus, operation: LocalAISetupStatus): LocalAIStatus {
  return { ...runtime, ...operation }
}

export function localAISetupStatusFrom(status: LocalAISetupStatus): LocalAISetupStatus {
  const { phase, managed, endpoint, model, message, progress, error, errorDetail, debugDetail, errorDebug, pullStage, errorKind, ownershipConflict, canRetry } = status
  return { phase, managed, endpoint, model, message, progress, error, errorDetail, debugDetail, errorDebug, pullStage, errorKind, ownershipConflict, canRetry }
}

export function errorStatus(error: unknown, phase: LocalAISetupStatus['phase'], model = MANAGED_OLLAMA_MODEL): LocalAISetupStatus {
  const nextError = toLocalAISetupErrorState(error, phase, fallbackLocalAISetupError(phase))
  return { phase: 'error', managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model, message: nextError.error, ...nextError, canRetry: true }
}

function fallbackLocalAISetupError(phase: LocalAISetupStatus['phase']): string {
  return phase === 'pulling_model'
    ? 'Local model download failed. Check your network connection, then retry Local AI setup.'
    : 'Managed Ollama Local AI setup failed'
}
