import { MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_MODEL } from '../shared/managed-local-ai'
import type { LocalAIStatus, LocalAISetupStatus } from '../shared/contracts'
import { toLocalAISetupErrorState } from './local-ai-setup-errors'

export function needsSetupStatus(overrides: Partial<LocalAISetupStatus> = {}): LocalAISetupStatus {
  return { phase: 'needs_setup', managed: true, endpoint: MANAGED_LLAMACPP_ENDPOINT, model: MANAGED_LLAMACPP_MODEL, message: 'Local AI setup is required', canRetry: false, ...overrides }
}

export function managedStatus(phase: LocalAISetupStatus['phase'], message: string, overrides: Partial<LocalAISetupStatus> = {}): LocalAISetupStatus {
  return { phase, managed: true, endpoint: MANAGED_LLAMACPP_ENDPOINT, model: MANAGED_LLAMACPP_MODEL, message, canRetry: false, ...overrides }
}

export function managedModelStatus(model: string, phase: LocalAISetupStatus['phase'], message: string, overrides: Partial<LocalAISetupStatus> = {}): LocalAISetupStatus {
  return managedStatus(phase, message, { model, ...overrides })
}

export function localAIStatusFrom(runtime: LocalAIStatus, operation: LocalAISetupStatus): LocalAIStatus {
  return { ...runtime, ...operation }
}

export function localAISetupStatusFrom(status: LocalAISetupStatus): LocalAISetupStatus {
  const { phase, managed, endpoint, model, message, progress, error, errorDetail, debugDetail, errorDebug, pullStage, errorKind, ownershipConflict, canRetry } = status
  return { phase, managed, endpoint, model, message, progress, error, errorDetail, debugDetail, errorDebug, pullStage, errorKind, ownershipConflict, canRetry }
}

export function errorStatus(error: unknown, phase: LocalAISetupStatus['phase'], model = MANAGED_LLAMACPP_MODEL): LocalAISetupStatus {
  const nextError = toLocalAISetupErrorState(error, phase, defaultLocalAISetupError(phase))
  return { phase: 'error', managed: true, endpoint: MANAGED_LLAMACPP_ENDPOINT, model, message: nextError.error, ...nextError, canRetry: true }
}

function defaultLocalAISetupError(phase: LocalAISetupStatus['phase']): string {
  return phase === 'pulling_model'
    ? 'Local model download failed. Check your network connection, then retry Local AI setup.'
    : 'Managed Local AI setup failed'
}
