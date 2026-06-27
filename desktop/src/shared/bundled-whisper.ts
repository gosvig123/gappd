import runtimeManifest from './runtime-manifest.json'

export const BUNDLED_WHISPER_BINARY_NAME = 'whisper-cli'
export const MANAGED_WHISPER_MODELS_DIRNAME = 'whisper-models'

export type ManagedWhisperModel = {
  id: string
  name: string
  label: string
  languageSupport: string
  description: string
  sizeMB: number
  url: string
  sha256: string
  default?: boolean
}

export const MANAGED_WHISPER_MODELS = runtimeManifest.whisper.models satisfies ManagedWhisperModel[]
export const DEFAULT_WHISPER_MODEL_ID = MANAGED_WHISPER_MODELS.find((model) => model.default)?.id ?? MANAGED_WHISPER_MODELS[0].id
export const MANAGED_WHISPER_MODEL = runtimeManifest.whisper.model.name
export const MANAGED_WHISPER_MODEL_URL = runtimeManifest.whisper.model.url
export const MANAGED_WHISPER_MODEL_SHA256 = runtimeManifest.whisper.model.sha256

export function managedWhisperModelById(id: string): ManagedWhisperModel | null {
  return MANAGED_WHISPER_MODELS.find((model) => model.id === id) ?? null
}
