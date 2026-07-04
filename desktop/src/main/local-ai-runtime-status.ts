import type { LocalAIConfig, LocalAIStatus } from '../shared/contracts'
import { appleSpeechAssetAvailable, missingAppleSpeechAssetMessage, missingAppleSpeechHelperMessage } from './apple-speech'
import { getManagedLlamaCppStatus } from './llamacpp'

export type LocalAIConfigProbe = { config: LocalAIConfig | null; error?: string }

export async function runtimeLocalAIStatus(probe: LocalAIConfigProbe): Promise<LocalAIStatus> {
  return withAppleSpeechReadiness(await getManagedLlamaCppStatus(probe.config, probe.error))
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
