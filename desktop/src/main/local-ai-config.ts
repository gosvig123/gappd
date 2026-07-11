import type { LocalAIConfig } from '../shared/contracts'
import { requestCommand } from './app-protocol'
import { acquireManagedLlamaCpp } from './llamacpp'

export async function getLocalAIConfig(): Promise<LocalAIConfig> {
  const result = await requestCommand('config.show', {})
  return result.ai
}

export async function saveManagedLocalAIConfig(input: { endpoint: string; model: string; temperature?: number }): Promise<LocalAIConfig> {
  const result = await requestCommand('config.useManagedLocalAI', input)
  return result.ai
}

export type LocalAILease = { release(): Promise<void> }

const EXTERNAL_LOCAL_AI_LEASE: LocalAILease = { release: async () => {} }

export async function acquireManagedLocalAI(): Promise<LocalAILease> {
  const config = await getLocalAIConfig()
  if (!config.managed) return EXTERNAL_LOCAL_AI_LEASE
  const lease = await acquireManagedLlamaCpp()
  try {
    if (config.endpoint !== lease.endpoint) await saveManagedLocalAIConfig({ endpoint: lease.endpoint, model: config.model, temperature: config.temperature })
    return lease
  } catch (error) {
    await lease.release()
    throw error
  }
}
