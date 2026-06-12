import runtimeManifest from './runtime-manifest.json'

export const BUNDLED_WHISPER_BINARY_NAME = 'whisper-cli'

export const MANAGED_WHISPER_MODEL = runtimeManifest.whisper.model.name
export const MANAGED_WHISPER_MODELS_DIRNAME = 'whisper-models'
export const MANAGED_WHISPER_MODEL_URL = runtimeManifest.whisper.model.url
export const MANAGED_WHISPER_MODEL_SHA256 = runtimeManifest.whisper.model.sha256
