import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AIProviderStatus as PiStatus, PiConfigurationInput as PiConfiguration, PiModelOption } from '../shared/ipc-contract'
import { requestCommand } from './app-protocol'
import { PiCredentialStore } from './pi-credential-store'

const PI_BACKEND = 'pi'
const JSON_TOOL = 'return_json'
const AUTH_VALIDITY_MS = 30_000

type PiModel = NonNullable<ReturnType<ModelRuntime['getModel']>>

export type PiCompletionRequest = { system: string; user: string; temperature: number; maxTokens: number; jsonSchema?: object }
export type PiCompletionResult = { text?: string; json?: object }

class PiRuntime {
  private readonly credentials = new PiCredentialStore()
  private readonly validatedUntil = new Map<string, number>()
  private runtimePromise: Promise<ModelRuntime> | null = null

  async status(): Promise<PiStatus> {
    const config = (await requestCommand('config.show', {})).ai
    const base = { selected: config.provider === PI_BACKEND, provider: config.piProvider, model: config.piModel }
    try {
      const runtime = await this.runtime()
      const models = modelOptions(runtime)
      try {
        const configured = Boolean(config.piProvider && await this.credentials.read(config.piProvider))
        if (base.selected && configured) await this.validateModel(runtime, requiredModel(runtime, base.provider, base.model))
        return { ...base, configured, models }
      } catch (error) {
        return { ...base, configured: false, models, error: errorMessage(error) }
      }
    } catch (error) {
      return { ...base, configured: false, models: [], error: errorMessage(error) }
    }
  }

  async configure(input: PiConfiguration): Promise<PiStatus> {
    const runtime = await this.runtime()
    const model = runtime.getModel(input.provider, input.model)
    if (!model) throw new Error(`Unknown Pi model ${input.provider}/${input.model}`)
    if (input.apiKey?.trim()) await this.saveApiKey(input.provider, input.apiKey.trim())
    if (!await this.credentials.read(input.provider)) throw new PiConfigurationError('API key required')
    if (!await runtime.getAuth(model)) throw new PiConfigurationError(`Credential could not be resolved for ${input.provider}`)
    try { await this.validateModel(runtime, model) }
    catch (error) { throw new PiConfigurationError(`Credential validation failed: ${errorMessage(error)}`) }
    await requestCommand('config.usePi', { provider: input.provider, model: input.model })
    return this.status()
  }

  async useLocal(): Promise<PiStatus> {
    const config = (await requestCommand('config.show', {})).ai
    await requestCommand('config.useManagedLocalAI', { endpoint: config.endpoint, model: config.model })
    return this.status()
  }

  async clearCredential(provider: string): Promise<PiStatus> {
    if (provider) await this.credentials.delete(provider)
    this.clearValidation(provider)
    return this.status()
  }

  async complete(request: PiCompletionRequest, signal?: AbortSignal): Promise<PiCompletionResult> {
    const status = await this.status()
    if (!status.selected || !status.configured) throw new PiConfigurationError('Pi setup required')
    const runtime = await this.runtime()
    const model = runtime.getModel(status.provider, status.model)
    if (!model) throw new PiConfigurationError(`Configured Pi model missing: ${status.provider}/${status.model}`)
    const response = await runtime.completeSimple(model, completionContext(request), {
      signal, temperature: request.temperature, maxTokens: request.maxTokens, maxRetries: 2,
    })
    if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(response.errorMessage || `Pi completion ${response.stopReason}`)
    return completionResult(response.content, Boolean(request.jsonSchema))
  }

  private async saveApiKey(provider: string, key: string): Promise<void> {
    const runtime = await this.runtime()
    if (!runtime.getProvider(provider)?.auth.apiKey) throw new PiConfigurationError(`${provider} does not support API-key setup`)
    await this.credentials.modify(provider, async () => ({ type: 'api_key', key }))
    this.clearValidation(provider)
    await runtime.refresh({ allowNetwork: false })
  }

  private async validateModel(runtime: ModelRuntime, model: PiModel): Promise<void> {
    const key = `${model.provider}/${model.id}`
    if ((this.validatedUntil.get(key) ?? 0) > Date.now()) return
    const response = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }] }, {
      maxTokens: 16, temperature: 0, maxRetries: 1, timeoutMs: 30_000,
    })
    if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(response.errorMessage || `Pi authentication ${response.stopReason}`)
    this.validatedUntil.set(key, Date.now() + AUTH_VALIDITY_MS)
  }

  private clearValidation(provider: string): void {
    for (const key of this.validatedUntil.keys()) if (key.startsWith(`${provider}/`)) this.validatedUntil.delete(key)
  }

  private runtime(): Promise<ModelRuntime> {
    this.runtimePromise ??= ModelRuntime.create({ credentials: this.credentials, modelsPath: null })
    return this.runtimePromise
  }
}

export class PiConfigurationError extends Error {
  readonly code = 'configuration_required'
}

export const piRuntime = new PiRuntime()

function requiredModel(runtime: ModelRuntime, provider: string, model: string): PiModel {
  const selected = runtime.getModel(provider, model)
  if (!selected) throw new PiConfigurationError(`Configured Pi model missing: ${provider}/${model}`)
  return selected
}

function modelOptions(runtime: ModelRuntime): PiModelOption[] {
  const names = new Map(runtime.getProviders().filter((provider) => provider.auth.apiKey).map((provider) => [provider.id, provider.name]))
  return runtime.getModels().filter((model) => names.has(model.provider)).map((model) => ({
    provider: model.provider, providerName: names.get(model.provider) ?? model.provider, id: model.id, name: model.name,
  }))
}

function completionContext(request: PiCompletionRequest) {
  const context: { systemPrompt: string; messages: object[]; tools?: object[] } = {
    systemPrompt: request.jsonSchema ? `${request.system}\nCall ${JSON_TOOL} exactly once with the final result.` : request.system,
    messages: [{ role: 'user', content: request.user, timestamp: Date.now() }],
  }
  if (request.jsonSchema) context.tools = [{
    name: JSON_TOOL, description: 'Return validated JSON only', parameters: request.jsonSchema,
    constrainedSampling: { type: 'json_schema', strict: 'require' },
  }]
  return context as Parameters<ModelRuntime['completeSimple']>[1]
}

function completionResult(content: readonly unknown[], structured: boolean): PiCompletionResult {
  const items = content as Array<{ type: string; name?: string; arguments?: unknown; text?: string }>
  if (structured) {
    const call = items.find((item) => item.type === 'toolCall' && item.name === JSON_TOOL)
    if (!call?.arguments || typeof call.arguments !== 'object') throw new Error('Pi model did not return required structured JSON')
    return { json: call.arguments as object }
  }
  return { text: items.filter((item) => item.type === 'text').map((item) => item.text).join('') }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
