import type { CodexStatusResponse } from '../shared/generated/contracts'
import { LOCAL_AI_PROVIDER_LLAMACPP } from '../shared/managed-local-ai'
import type { ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { requestCommand } from './app-protocol'
import type { RuntimeProbe } from './managed-runtime-status'

const CODEX_PROVIDER = 'codex_exec'
const CODEX_STATUS_FALLBACK = 'Installed Codex is unavailable'

type ResumeContext = {
  generation: number
  prepare: Promise<unknown> | null
  model: string | null
}

type ResumeHooks = {
  current(generation: number): boolean
  refresh(health: CodexStatusResponse, generation: number): Promise<ManagedRuntimeSnapshot>
  prepare(model: string): void
}

export async function loadProviderProbe(providerHealth?: CodexStatusResponse): Promise<RuntimeProbe> {
  try { return probeFor(providerHealth ?? await requestCommand('config.codexStatus', {})) }
  catch (error) { return { config: null, error: errorMessage(error) } }
}

export async function resumeManagedRepair(context: ResumeContext, hooks: ResumeHooks): Promise<void> {
  await context.prepare?.catch(() => undefined)
  if (!hooks.current(context.generation)) return
  const health = await requestCommand('config.codexStatus', {})
  if (!hooks.current(context.generation) || !isManagedLocal(health)) return
  const snapshot = await hooks.refresh(health, context.generation)
  if (snapshot.operation !== 'ready') hooks.prepare(context.model || health.ai.model)
}

export function isManagedLocal(health: CodexStatusResponse): boolean {
  return health.ai.provider === LOCAL_AI_PROVIDER_LLAMACPP && health.ai.managed
}

function probeFor(status: CodexStatusResponse): RuntimeProbe {
  const providerError = status.ai.provider === CODEX_PROVIDER && !status.available
    ? status.error || CODEX_STATUS_FALLBACK : undefined
  return { config: status.ai, ...(providerError ? { providerError } : {}) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
