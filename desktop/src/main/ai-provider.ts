import type { AIProviderStatus, CodexConfigurationInput } from '../shared/ipc-contract'
import type { AIConfig, CodexStatusResponse } from '../shared/generated/contracts'
import { requestCommand } from './app-protocol'

const LOCAL_PROVIDER = 'local'
const CODEX_PROVIDER = 'codex_exec'

export type AIProviderResult = { status: AIProviderStatus; health: CodexStatusResponse }

export async function providerStatus(): Promise<AIProviderResult> {
  const health = await requestCommand('config.codexStatus', {})
  return resultFor(health)
}

export async function configureCodex(input: CodexConfigurationInput): Promise<AIProviderResult> {
  const response = await requestCommand('config.useCodex', { executable: input.executable.trim(), model: input.model.trim() })
  return resultFor(healthyConfig(response.ai))
}

export async function useLocalProvider(): Promise<AIProviderResult> {
  const config = (await requestCommand('config.show', {})).ai
  const response = await requestCommand('config.useManagedLocalAI', { endpoint: config.endpoint, model: config.model })
  return resultFor(healthyConfig(response.ai))
}

function healthyConfig(ai: AIConfig): CodexStatusResponse {
  return { ai, available: true }
}

function resultFor(health: CodexStatusResponse): AIProviderResult {
  const config = health.ai
  return {
    health,
    status: {
      provider: config.provider === CODEX_PROVIDER ? CODEX_PROVIDER : LOCAL_PROVIDER,
      codexExecutable: config.codexExecutable, codexModel: config.codexModel,
      available: health.available, ...(health.error ? { error: health.error } : {}),
    },
  }
}
