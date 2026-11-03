import { useCallback, useState } from 'react'
import type { ErrorReportStatus } from '../../shared/error-report'
import { useGuardedEffect } from './use-guarded-effect'

/** Whether this Mac sends anonymous error reports. status is null while it loads. */
export function useErrorReports() {
  const [status, setStatus] = useState<ErrorReportStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useGuardedEffect((guard) => {
    window.gappd.errorReports.status().then((next) => guard(() => setStatus(next)))
      .catch((cause) => guard(() => setError(errorMessage(cause))))
  }, [])
  const setSharing = useCallback(async (enabled: boolean) => {
    try {
      setStatus(await window.gappd.errorReports.setSharing(enabled))
      setError(null)
    } catch (cause) {
      setError(`Could not save the error report choice: ${errorMessage(cause)}. Try again.`)
    }
  }, [])
  return { status, error, setSharing }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
