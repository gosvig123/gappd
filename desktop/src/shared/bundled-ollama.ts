import runtimeManifest from './runtime-manifest.json'

export const BUNDLED_OLLAMA_RELEASE = runtimeManifest.ollama.release
export const BUNDLED_OLLAMA_ARTIFACT = runtimeManifest.ollama.artifact
export const BUNDLED_OLLAMA_SHA256 = runtimeManifest.ollama.sha256
export const BUNDLED_OLLAMA_URL = `https://github.com/ollama/ollama/releases/download/${BUNDLED_OLLAMA_RELEASE}/${BUNDLED_OLLAMA_ARTIFACT}`
export const BUNDLED_OLLAMA_BINARY_NAME = 'ollama'
export const BUNDLED_OLLAMA_CACHE_DIRNAME = '.cache'
export const BUNDLED_OLLAMA_CACHE_ROOT_DIRNAME = 'ollama'

// Prefer a stable managed port, but desktop startup may pick another free local
// port when this one is already occupied. gappd learns the live endpoint via
// `app config use-managed-ollama`.
export const MANAGED_OLLAMA_HOST = '127.0.0.1'
export const MANAGED_OLLAMA_PORT = 11435
export const MANAGED_OLLAMA_ENDPOINT = `http://${MANAGED_OLLAMA_HOST}:${MANAGED_OLLAMA_PORT}`
export const MANAGED_OLLAMA_MODEL = 'llama3.1:8b'
export const FAST_MANAGED_OLLAMA_MODEL = 'qwen3:1.7b'
export const MANAGED_OLLAMA_MODELS_DIRNAME = 'ollama-models'

export const MANAGED_OLLAMA_MODEL_OPTIONS = [
  { tag: MANAGED_OLLAMA_MODEL, label: 'Recommended: Llama 3.1 8B', detail: 'Best quality default. Larger download and setup time.' },
  { tag: FAST_MANAGED_OLLAMA_MODEL, label: 'Fast: Qwen3 1.7B', detail: 'Smaller, faster setup. Lower quality on long or subtle meetings.' },
] as const

export type ManagedOllamaModelOption = typeof MANAGED_OLLAMA_MODEL_OPTIONS[number]
export type ManagedOllamaModelTag = ManagedOllamaModelOption['tag']

export function isManagedOllamaModel(value: string): value is ManagedOllamaModelTag {
  return MANAGED_OLLAMA_MODEL_OPTIONS.some((option) => option.tag === value)
}
