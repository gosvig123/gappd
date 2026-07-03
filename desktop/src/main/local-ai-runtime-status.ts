import type { LocalAIConfig, LocalAIStatus } from '../shared/contracts'
import { getManagedLlamaCppStatus } from './llamacpp'
import { bundledWhisperAvailable, managedWhisperModelAvailable, missingBundledWhisperMessage, missingManagedWhisperModelMessage } from './whisper'

export type LocalAIConfigProbe = { config: LocalAIConfig | null; error?: string }

export async function runtimeLocalAIStatus(probe: LocalAIConfigProbe): Promise<LocalAIStatus> {
  return withWhisperReadiness(await getManagedLlamaCppStatus(probe.config, probe.error))
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
