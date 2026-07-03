import type { LocalAIConfig } from '../shared/contracts'
import { requestCommand } from './app-protocol'
import { ensureManagedLlamaCppRunning } from './llamacpp'

export async function getLocalAIConfig(): Promise<LocalAIConfig> {
  const result = await requestCommand('config.show', {})
  return result.ai
}

export async function saveManagedLocalAIConfig(input: { endpoint: string; model: string; temperature?: number }): Promise<LocalAIConfig> {
  const result = await requestCommand('config.useManagedLocalAI', input)
  return result.ai
}

export async function ensureManagedLocalAIReady(): Promise<void> {
  const config = await getLocalAIConfig()
  if (!config.managed) return
  const endpoint = await ensureManagedLlamaCppRunning()
  if (config.endpoint === endpoint) return
  await saveManagedLocalAIConfig({ endpoint, model: config.model, temperature: config.temperature })
}
