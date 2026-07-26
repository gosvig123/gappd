import type { AIConfig } from '../shared/generated/contracts'
import type { ManagedRuntimeOperation, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { LOCAL_AI_PROVIDER_LLAMACPP, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_MODEL } from '../shared/managed-local-ai'
import { appleSpeechAssetAvailable, missingAppleSpeechAssetMessage } from './apple-speech'
import { managedLanguageModelAvailable, missingManagedLanguageModelMessage } from './language-model'
import { getManagedLlamaCppRuntimeStatus, missingBundledLlamaCppMessage } from './llamacpp'
import { toManagedRuntimeErrorState } from './managed-runtime-errors'
import { diarizationAssetsAvailable, missingDiarizationAssetsMessage } from './diarization'

export type RuntimeProbe = { config: AIConfig | null; error?: string }

export function initialRuntimeSnapshot(): ManagedRuntimeSnapshot {
  return baseSnapshot('checking', 'Checking Managed Runtime readiness')
}

export async function probeRuntime(input: RuntimeProbe): Promise<ManagedRuntimeSnapshot> {
  try { return await buildProbeSnapshot(input) }
  catch (error) { return runtimeErrorSnapshot(error, 'checking') }
}

async function buildProbeSnapshot(input: RuntimeProbe): Promise<ManagedRuntimeSnapshot> {
  if (input.error) return runtimeErrorSnapshot(input.error, 'checking')
  const runtime = await getManagedLlamaCppRuntimeStatus()
  const modelReady = runtime.bundled && await managedLanguageModelAvailable(MANAGED_LLAMACPP_MODEL)
  const speechReady = runtime.supported && await appleSpeechAssetAvailable()
  const diarizationReady = runtime.supported && await diarizationAssetsAvailable()
  const configured = isManagedConfig(input.config)
  const operation = probeOperation(runtime.supported, runtime.bundled, modelReady, speechReady, configured)
  return {
    ...baseSnapshot(operation, probeMessage(operation, runtime.bundled, modelReady, speechReady)),
    supported: runtime.supported, bundled: runtime.bundled, running: runtime.running, configured,
    endpoint: runtime.endpoint, canRetry: operation !== 'ready', canRepair: runtime.supported,
    capabilities: {
      summarization: { readiness: modelReady ? 'ready' : runtime.bundled ? 'missing' : 'unavailable', message: modelReady ? undefined : runtime.bundled ? missingManagedLanguageModelMessage() : missingBundledLlamaCppMessage() },
      transcription: { readiness: speechReady ? 'ready' : 'missing', message: speechReady ? undefined : missingAppleSpeechAssetMessage() },
      diarization: { readiness: diarizationReady ? 'ready' : 'missing', message: diarizationReady ? undefined : missingDiarizationAssetsMessage() },
    },
  }
}

export function runtimeErrorSnapshot(error: unknown, phase: ManagedRuntimeOperation, current = initialRuntimeSnapshot()): ManagedRuntimeSnapshot {
  const detail = toManagedRuntimeErrorState(error, phase, 'Managed Runtime needs attention')
  return { ...current, operation: 'error', message: detail.error, ...detail, canRetry: true, canRepair: current.supported }
}

export function baseSnapshot(operation: ManagedRuntimeOperation, message: string): ManagedRuntimeSnapshot {
  return {
    operation, activity: 'idle', endpoint: MANAGED_LLAMACPP_ENDPOINT, model: MANAGED_LLAMACPP_MODEL,
    message, supported: process.platform === 'darwin', configured: false, bundled: false, running: false,
    canRetry: false, canRepair: false,
    capabilities: { summarization: { readiness: 'missing' }, transcription: { readiness: 'missing' }, diarization: { readiness: 'missing' } },
  }
}

function isManagedConfig(config: AIConfig | null): boolean {
  return Boolean(config?.managed && config.provider === LOCAL_AI_PROVIDER_LLAMACPP && config.model === MANAGED_LLAMACPP_MODEL)
}

function probeOperation(supported: boolean, bundled: boolean, model: boolean, speech: boolean, configured: boolean): ManagedRuntimeOperation {
  if (!supported || !bundled) return 'error'
  return model && speech && configured ? 'ready' : 'needs_setup'
}

function probeMessage(operation: ManagedRuntimeOperation, bundled: boolean, model: boolean, speech: boolean): string {
  if (!bundled) return missingBundledLlamaCppMessage()
  if (!model) return missingManagedLanguageModelMessage()
  if (!speech) return missingAppleSpeechAssetMessage()
  return operation === 'ready' ? 'Managed Runtime is ready and starts when needed' : 'Managed Runtime setup is required'
}
