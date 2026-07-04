import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus } from '../shared/contracts'
import { LOCAL_AI_PROVIDER_LLAMACPP, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_MODEL } from '../shared/managed-local-ai'
import { appleSpeechAssetAvailable, missingAppleSpeechAssetMessage, missingAppleSpeechHelperMessage } from './apple-speech'
import { managedLanguageModelAvailable, missingManagedLanguageModelMessage } from './language-model'
import { getManagedLlamaCppRuntimeStatus, missingBundledLlamaCppMessage, type ManagedLlamaCppRuntimeStatus } from './llamacpp'
import { toLocalAISetupErrorState, type LocalAISetupErrorState } from './local-ai-setup-errors'

export type LocalAIConfigProbe = { config: LocalAIConfig | null; error?: string }
type StatusContext = ManagedLlamaCppRuntimeStatus & { config: LocalAIConfig | null; configError?: string; configured: boolean; modelAvailable: boolean }

export async function runtimeLocalAIStatus(probe: LocalAIConfigProbe): Promise<LocalAIStatus> {
  const runtime = await getManagedLlamaCppRuntimeStatus()
  const model = probe.config?.model || MANAGED_LLAMACPP_MODEL
  const modelAvailable = await managedLanguageModelAvailable(model)
  const configured = isManagedLlamaCppConfigured(probe.config)
  return withAppleSpeechReadiness(localAIStatus({ ...runtime, config: probe.config, configError: probe.error, configured, modelAvailable }))
}

function localAIStatus(context: StatusContext): LocalAIStatus {
  const phase = localAIPhase(context)
  const error = statusError(context, phase)
  return { phase, managed: Boolean(context.config?.managed ?? true), endpoint: context.running ? context.endpoint : context.config?.endpoint || MANAGED_LLAMACPP_ENDPOINT, model: context.config?.model || MANAGED_LLAMACPP_MODEL, message: localAIMessage(context), error: error?.error, errorDetail: error?.errorDetail, debugDetail: error?.debugDetail, errorDebug: error?.errorDebug, errorKind: error?.errorKind, ownershipConflict: error?.ownershipConflict, canRetry: phase === 'error' || !context.modelAvailable, supported: context.supported, configured: context.configured, bundled: context.bundled, running: context.running, canRepair: context.supported && context.bundled }
}

function statusError(context: StatusContext, phase: LocalAIStatus['phase']): LocalAISetupErrorState | undefined {
  if (context.configError) return toLocalAISetupErrorState(context.configError, phase, 'Failed to read local AI configuration')
  return phase === 'error' ? context.error : undefined
}

async function withAppleSpeechReadiness(next: LocalAIStatus): Promise<LocalAIStatus> {
  if (!next.bundled) return next
  try {
    if (next.phase === 'ready' && !(await appleSpeechAssetAvailable())) return appleSpeechMissingStatus(next)
    return next
  } catch (error) {
    return appleSpeechRuntimeError(next, error)
  }
}

function appleSpeechMissingStatus(next: LocalAIStatus): LocalAIStatus {
  return { ...next, phase: 'needs_setup', message: missingAppleSpeechAssetMessage(), canRetry: true }
}

function appleSpeechRuntimeError(next: LocalAIStatus, error: unknown): LocalAIStatus {
  const message = error instanceof Error ? error.message : missingAppleSpeechHelperMessage()
  return { ...next, phase: 'error', message, error: message, errorKind: 'runtime', bundled: false, canRepair: false }
}

function isManagedLlamaCppConfigured(config: LocalAIConfig | null | undefined): boolean {
  return Boolean(isManagedLocalAIConfigured(config) && config?.provider === LOCAL_AI_PROVIDER_LLAMACPP)
}

function localAIPhase(context: StatusContext): LocalAIStatus['phase'] {
  if (context.configError || !context.supported || !context.bundled) return 'error'
  if (!context.modelAvailable) return 'needs_setup'
  if (context.configured && context.running) return 'ready'
  if (context.configured) return 'error'
  return 'needs_setup'
}

function localAIMessage(context: StatusContext): string {
  if (context.configError) return 'Failed to read local AI configuration'
  if (!context.supported) return 'Managed llama.cpp is unavailable on this platform'
  if (!context.bundled) return missingBundledLlamaCppMessage()
  if (!context.modelAvailable) return missingManagedLanguageModelMessage()
  if (context.configured && context.running) return 'Managed llama.cpp is running'
  if (context.configured) return 'Managed llama.cpp is configured but stopped'
  if (context.config && !context.config.managed) return 'Gappd is configured for external Local AI. Run Local AI setup to switch to the managed runtime.'
  if (context.running) return 'Managed llama.cpp is running but Local AI setup has not switched Gappd to it yet.'
  return 'Managed llama.cpp is ready for Local AI setup'
}
