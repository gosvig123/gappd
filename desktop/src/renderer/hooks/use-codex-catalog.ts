import { useCallback, useState } from 'react'
import type { CodexModelCatalog } from '../../shared/ipc-contract'
import { useGuardedEffect } from './use-guarded-effect'

export type CodexCatalogState = {
  catalog: CodexModelCatalog | null
  loading: boolean
  error: string | null
  refresh(): void
}

/**
 * Loads the installed Codex model catalog for the entered executable, so first
 * setup can discover models before anything is saved. Discovery failures stay
 * visible and never fall back to a model the install does not advertise.
 */
export function useCodexCatalog(enabled: boolean, executable: string): CodexCatalogState {
  const [catalog, setCatalog] = useState<CodexModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const entered = executable.trim()

  useGuardedEffect((guard) => {
    if (!enabled || !entered) return
    setLoading(true)
    setError(null)
    window.gappd.aiProvider.models(entered)
      .then((value) => guard(() => { setCatalog(value); setLoading(false) }))
      .catch((cause) => guard(() => { setCatalog(null); setError(errorMessage(cause)); setLoading(false) }))
  }, [enabled, entered, attempt])

  return { catalog, loading, error, refresh: useCallback(() => setAttempt((value) => value + 1), []) }
}

function errorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking (?:remote method )?['"]?aiProvider:models['"]?:\s*/, '').replace(/^(?:Error:\s*)+/, '').trim() || 'Could not read the installed Codex model catalog.'
}
