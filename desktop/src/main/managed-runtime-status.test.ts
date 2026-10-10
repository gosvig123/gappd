import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import * as localAi from '../shared/managed-local-ai.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

const MANAGED_CONFIG = { provider: localAi.LOCAL_AI_PROVIDER_LLAMACPP, managed: true, model: localAi.MANAGED_LLAMACPP_MODEL }

function status(assets: { llamacpp: boolean; speech: boolean; diarization: boolean }) {
  return loadSourceModule(new URL('./managed-runtime-status.ts', import.meta.url), {
    '../shared/managed-local-ai': localAi,
    './app-protocol': { requestCommand: async () => assert.fail('probe input is supplied directly') },
    './apple-speech': { appleSpeechAssetAvailable: async () => assets.speech, missingAppleSpeechAssetMessage: () => 'speech missing' },
    './language-model': { managedLanguageModelAvailable: async () => true, missingManagedLanguageModelMessage: () => 'model missing' },
    './llamacpp': {
      getManagedLlamaCppRuntimeStatus: async () => ({ supported: true, bundled: assets.llamacpp, running: false, endpoint: localAi.MANAGED_LLAMACPP_ENDPOINT }),
      missingBundledLlamaCppMessage: () => 'llama.cpp missing',
    },
    './managed-runtime-errors': { toManagedRuntimeErrorState: (error: unknown) => ({ error: String(error), errorKind: 'runtime' }) },
    './diarization': { diarizationAssetsAvailable: async () => assets.diarization, missingDiarizationAssetsMessage: () => 'diarization missing' },
  }, { process: { platform: 'darwin' } })
}

test('missing diarization assets leave transcription and summarization ready', async () => {
  const snapshot = await status({ llamacpp: true, speech: true, diarization: false }).probeRuntime({ config: MANAGED_CONFIG })
  assert.equal(snapshot.operation, 'ready')
  assert.equal(snapshot.capabilities.transcription.readiness, 'ready')
  assert.equal(snapshot.capabilities.summarization.readiness, 'ready')
  assert.equal(snapshot.capabilities.diarization.readiness, 'missing')
  assert.equal(snapshot.capabilities.diarization.message, 'diarization missing')
})

test('missing llama.cpp runtime leaves transcription and diarization readiness intact', async () => {
  const snapshot = await status({ llamacpp: false, speech: true, diarization: true }).probeRuntime({ config: MANAGED_CONFIG })
  assert.equal(snapshot.capabilities.summarization.readiness, 'unavailable')
  assert.equal(snapshot.capabilities.transcription.readiness, 'ready')
  assert.equal(snapshot.capabilities.diarization.readiness, 'ready')
})
