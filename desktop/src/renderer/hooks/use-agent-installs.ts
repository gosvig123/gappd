import { useCallback, useState } from 'react'
import type { AgentInstall } from '../../shared/ipc-contract'
import { AGENTS } from '../../shared/agents'
import { useGuardedEffect } from './use-guarded-effect'

export type AgentInstallsState = { installs: AgentInstall[] | null; checking: boolean; recheck(): void }

/**
 * Finds the installed agent CLIs, so nobody types a path. A failed search
 * counts as nothing installed.
 */
export function useAgentInstalls(enabled: boolean): AgentInstallsState {
  const [installs, setInstalls] = useState<AgentInstall[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useGuardedEffect((guard) => {
    if (!enabled) return
    setChecking(true)
    window.gappd.aiProvider.find()
      .then((value) => guard(() => { setInstalls(value); setChecking(false) }))
      .catch(() => guard(() => { setInstalls(AGENTS.map((agent) => ({ agent: agent.id, executable: '', version: '', signedIn: false }))); setChecking(false) }))
  }, [enabled, attempt])

  return { installs, checking, recheck: useCallback(() => setAttempt((value) => value + 1), []) }
}
