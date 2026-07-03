export const LOCAL_AI_PROVIDER_LLAMACPP = 'llamacpp'

export const MANAGED_LLAMACPP_HOST = '127.0.0.1'
export const MANAGED_LLAMACPP_PORT = 11436
export const MANAGED_LLAMACPP_ENDPOINT = `http://${MANAGED_LLAMACPP_HOST}:${MANAGED_LLAMACPP_PORT}`
export const MANAGED_LLAMACPP_MODEL = 'LiquidAI/LFM2-2.6B-Transcript-GGUF'
export const MANAGED_LLAMACPP_MODEL_FILE = 'LFM2-2.6B-Transcript-Q4_K_M.gguf'
export const MANAGED_LLAMACPP_MODELS_DIRNAME = 'llamacpp-models'
export const BUNDLED_LLAMACPP_BINARY_NAME = 'llama-server'

export const MANAGED_LLAMACPP_MODEL_OPTIONS = [
  {
    tag: MANAGED_LLAMACPP_MODEL,
    label: 'Best for meetings',
    detail: 'LFM2 transcript model. Small, fast, and tuned for private meeting summaries.',
  },
] as const

export type ManagedLlamaCppModelOption = typeof MANAGED_LLAMACPP_MODEL_OPTIONS[number]
export type ManagedLlamaCppModelTag = ManagedLlamaCppModelOption['tag']

export function isManagedLlamaCppModel(value: string): value is ManagedLlamaCppModelTag {
  return MANAGED_LLAMACPP_MODEL_OPTIONS.some((option) => option.tag === value)
}

export const MANAGED_LLAMACPP_MODEL_ARTIFACT = {
  id: MANAGED_LLAMACPP_MODEL,
  name: MANAGED_LLAMACPP_MODEL_FILE,
  label: 'LFM2 Transcript Q4_K_M',
  url: `https://huggingface.co/${MANAGED_LLAMACPP_MODEL}/resolve/main/${MANAGED_LLAMACPP_MODEL_FILE}`,
  sha256: '74832bbf09a5321bfd119e13c6c1fd6361517d3f085545cf00b79c7dc8cceac6',
  size: 1563669248,
} as const
