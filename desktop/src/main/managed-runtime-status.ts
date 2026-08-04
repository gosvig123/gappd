import type { AIConfig } from '../shared/generated/contracts'
import type { ManagedRuntimeOperation, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { LOCAL_AI_PROVIDER_LLAMACPP, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_MODEL } from '../shared/managed-local-ai'
import { appleSpeechAssetAvailable, missingAppleSpeechAssetMessage } from './apple-speech'
import { managedLanguageModelAvailable, missingManagedLanguageModelMessage } from './language-model'
import { getManagedLlamaCppRuntimeStatus, missingBundledLlamaCppMessage } from './llamacpp'
import { toManagedRuntimeErrorState } from './managed-runtime-errors'
import { diarizationAssetsAvailable, missingDiarizationAssetsMessage } from './diarization'

export type RuntimeProbe = { config: AIConfig | null; error?: string; providerError?: string }

const CODEX_PROVIDER = 'codex_exec'

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
  const usesCodex = input.config?.provider === CODEX_PROVIDER
  const summarizationReady = usesCodex ? !input.providerError : modelReady
  const runtimeReady = usesCodex ? summarizationReady : runtime.bundled
  const configured = usesCodex || isManagedConfig(input.config)
  const operation = probeOperation(runtime.supported, runtimeReady, summarizationReady, speechReady, configured)
  return {
    ...baseSnapshot(operation, probeMessage(operation, runtimeReady, summarizationReady, speechReady, input.providerError)),
    supported: runtime.supported, bundled: runtime.bundled, running: runtime.running, configured,
    endpoint: runtime.endpoint, canRetry: operation !== 'ready', canRepair: runtime.supported,
    capabilities: {
      summarization: summarizationStatus(usesCodex, summarizationReady, runtime.bundled, input.providerError),
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

function summarizationStatus(usesCodex: boolean, ready: boolean, bundled: boolean, providerError?: string) {
  if (ready) return { readiness: 'ready' as const }
  if (usesCodex) return { readiness: 'unavailable' as const, message: providerError }
  return bundled
    ? { readiness: 'missing' as const, message: missingManagedLanguageModelMessage() }
    : { readiness: 'unavailable' as const, message: missingBundledLlamaCppMessage() }
}

function probeMessage(operation: ManagedRuntimeOperation, runtime: boolean, summary: boolean, speech: boolean, providerError?: string): string {
  if (providerError) return providerError
  if (!runtime) return missingBundledLlamaCppMessage()
  if (!summary) return missingManagedLanguageModelMessage()
  if (!speech) return missingAppleSpeechAssetMessage()
  return operation === 'ready' ? 'Managed Runtime is ready and starts when needed' : 'Managed Runtime setup is required'
}
