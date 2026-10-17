import type { AgentConfigurationInput, AgentId, AgentInstall, AgentModelCatalog, AIProviderStatus } from '../shared/ipc-contract'
import type { AIConfig, AIStatusResponse } from '../shared/generated/contracts'
import { isAgentId } from '../shared/agents'
import { requestCommand } from './app-protocol'

const LOCAL_PROVIDER = 'local'

type AIProviderResult = { status: AIProviderStatus; health: AIStatusResponse }

export async function providerStatus(): Promise<AIProviderResult> {
  const health = await requestCommand('config.aiStatus', {})
  return resultFor(health)
}

/** Every agent the backend knows that this app can show, in display order. */
export async function findAgents(): Promise<AgentInstall[]> {
  const { agents } = await requestCommand('config.findAgents', {})
  return agents.flatMap((install) => isAgentId(install.agent) ? [{ ...install, agent: install.agent }] : [])
}

export async function providerModels(agent: AgentId, executable?: string): Promise<AgentModelCatalog> {
  return requestCommand('config.agentModels', { agent, executable: executable ?? '' })
}

export async function configureAgent(input: AgentConfigurationInput): Promise<AIProviderResult> {
  const response = await requestCommand('config.useAgent', { agent: input.agent, executable: input.executable.trim(), model: input.model.trim(), reasoningEffort: input.reasoningEffort.trim() })
  return resultFor(healthyConfig(response.ai))
}

export async function useLocalProvider(): Promise<AIProviderResult> {
  const config = (await requestCommand('config.show', {})).ai
  const response = await requestCommand('config.useManagedLocalAI', { endpoint: config.endpoint, model: config.model })
  return resultFor(healthyConfig(response.ai))
}

function healthyConfig(ai: AIConfig): AIStatusResponse {
  return { ai, available: true }
}

function resultFor(health: AIStatusResponse): AIProviderResult {
  const config = health.ai
  return {
    health,
    status: {
      provider: isAgentId(config.provider) ? config.provider : LOCAL_PROVIDER,
      agentExecutable: config.agentExecutable, agentModel: config.agentModel, agentReasoningEffort: config.agentReasoningEffort,
      available: health.available, ...(health.error ? { error: health.error } : {}),
    },
  }
}
