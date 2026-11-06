import { useCallback, useState } from 'react'
import type { UsageReportStatus } from '../../shared/usage-report'
import { useGuardedEffect } from './use-guarded-effect'

/** Whether this Mac shares anonymous usage counts. status is null while it loads. */
export function useUsageSharing() {
  const [status, setStatus] = useState<UsageReportStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useGuardedEffect((guard) => {
    window.gappd.usage.status().then((next) => guard(() => setStatus(next)))
      .catch((cause) => guard(() => setError(errorMessage(cause))))
  }, [])
  /** Saves the choice and reports whether it was saved. */
  const setSharing = useCallback(async (enabled: boolean): Promise<boolean> => {
    try {
      setStatus(await window.gappd.usage.setSharing(enabled))
      setError(null)
      return true
    } catch (cause) {
      setError(`Could not save the usage sharing choice: ${errorMessage(cause)}. Try again.`)
      return false
    }
  }, [])
  return { status, error, setSharing }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
