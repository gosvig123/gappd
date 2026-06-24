import { MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_MODEL } from '../shared/bundled-ollama'
import type { LocalAIStatus, OnboardingStatus } from '../shared/contracts'
import { toOnboardingErrorState } from './onboarding-errors'

export function needsSetupStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return { phase: 'needs_setup', managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL, message: 'Local AI setup is required', canRetry: false, ...overrides }
}

export function managedStatus(phase: OnboardingStatus['phase'], message: string, overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return { phase, managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL, message, canRetry: false, ...overrides }
}

export function managedModelStatus(model: string, phase: OnboardingStatus['phase'], message: string, overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return managedStatus(phase, message, { model, ...overrides })
}

export function missingModelStatus(model: string, endpoint = MANAGED_OLLAMA_ENDPOINT): OnboardingStatus {
  return needsSetupStatus({ endpoint, model, message: `Managed Ollama is running, but model ${model} is missing. Run setup to pull it again.`, canRetry: true })
}

export function localAIStatusFrom(runtime: LocalAIStatus, operation: OnboardingStatus): LocalAIStatus {
  return { ...runtime, ...operation }
}

export function onboardingStatusFrom(status: OnboardingStatus): OnboardingStatus {
  const { phase, managed, endpoint, model, message, progress, error, errorDetail, debugDetail, errorDebug, pullStage, errorKind, ownershipConflict, canRetry } = status
  return { phase, managed, endpoint, model, message, progress, error, errorDetail, debugDetail, errorDebug, pullStage, errorKind, ownershipConflict, canRetry }
}

export function errorStatus(error: unknown, phase: OnboardingStatus['phase'], model = MANAGED_OLLAMA_MODEL): OnboardingStatus {
  const nextError = toOnboardingErrorState(error, phase, fallbackOnboardingError(phase))
  return { phase: 'error', managed: true, endpoint: MANAGED_OLLAMA_ENDPOINT, model, message: nextError.error, ...nextError, canRetry: true }
}

function fallbackOnboardingError(phase: OnboardingStatus['phase']): string {
  return phase === 'pulling_model'
    ? 'Local model download failed. Check your network connection, then retry Local AI setup.'
    : 'Managed Ollama onboarding failed'
}
