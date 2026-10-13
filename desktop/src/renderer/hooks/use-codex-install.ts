import { useCallback, useState } from 'react'
import type { CodexInstall } from '../../shared/ipc-contract'
import { useGuardedEffect } from './use-guarded-effect'

export type CodexInstallState = { install: CodexInstall | null; checking: boolean; recheck(): void }

/**
 * Finds the installed Codex CLI, so nobody types a path. A failed search
 * counts as not installed: the Codex choice only appears when Codex is found.
 */
export function useCodexInstall(enabled: boolean): CodexInstallState {
  const [install, setInstall] = useState<CodexInstall | null>(null)
  const [checking, setChecking] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useGuardedEffect((guard) => {
    if (!enabled) return
    setChecking(true)
    window.gappd.aiProvider.find()
      .then((value) => guard(() => { setInstall(value); setChecking(false) }))
      .catch(() => guard(() => { setInstall({ executable: '', version: '', signedIn: false }); setChecking(false) }))
  }, [enabled, attempt])

  return { install, checking, recheck: useCallback(() => setAttempt((value) => value + 1), []) }
}
