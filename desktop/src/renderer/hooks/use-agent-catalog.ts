import { useCallback, useState } from 'react'
import type { AgentId, AgentModelCatalog } from '../../shared/ipc-contract'
import { agentInfo } from '../../shared/agents'
import { useGuardedEffect } from './use-guarded-effect'

export type AgentCatalogState = {
  catalog: AgentModelCatalog | null
  loading: boolean
  error: string | null
  refresh(): void
}

type Loaded = { key: string; catalog: AgentModelCatalog | null; error: string | null }

/**
 * Loads one installed agent's model catalog for its executable, so first setup
 * can discover models before anything is saved. A catalog shows only for the
 * agent it was read from. Discovery failures stay visible and never fall back
 * to a model the install does not advertise.
 */
export function useAgentCatalog(agent: AgentId | null, executable: string): AgentCatalogState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const entered = executable.trim()
  const key = agent && entered ? `${agent}\n${entered}\n${attempt}` : ''

  useGuardedEffect((guard) => {
    if (!agent || !entered) return
    window.gappd.aiProvider.models(agent, entered)
      .then((catalog) => guard(() => setLoaded({ key, catalog, error: null })))
      .catch((cause) => guard(() => setLoaded({ key, catalog: null, error: errorMessage(cause, agentInfo(agent).name) })))
  }, [key])

  const current = key && loaded?.key === key ? loaded : null
  return {
    catalog: current?.catalog ?? null,
    loading: Boolean(key) && !current,
    error: current?.error ?? null,
    refresh: useCallback(() => setAttempt((value) => value + 1), []),
  }
}

function errorMessage(cause: unknown, name: string): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking (?:remote method )?['"]?aiProvider:models['"]?:\s*/, '').replace(/^(?:Error:\s*)+/, '').trim() || `Could not read the installed ${name} model catalog.`
}
