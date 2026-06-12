import { useCallback, useState } from 'react'
import type { UpdateDownloadResult, UpdateStatus } from '../../shared/contracts'
import { useGuardedEffect } from './use-guarded-effect'

const UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const applyStatus = useCallback((next: UpdateStatus) => {
    setStatus(next.available ? next : null)
    return next
  }, [])

  const checkNow = useCallback(async (): Promise<UpdateStatus> => {
    setChecking(true)
    try {
      return applyStatus(await window.gappd.update.checkNow())
    } finally {
      setChecking(false)
    }
  }, [applyStatus])

  const downloadUpdate = useCallback(async (): Promise<UpdateDownloadResult> => {
    setDownloading(true)
    try {
      return await window.gappd.update.downloadUpdate()
    } finally {
      setDownloading(false)
    }
  }, [])

  useGuardedEffect((guard) => {
    const refresh = () => {
      window.gappd.update.checkNow()
        .then((next) => guard(() => applyStatus(next)))
        .catch(() => guard(() => setStatus(null)))
    }
    refresh()
    const timer = window.setInterval(refresh, UPDATE_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [applyStatus])

  return { status, checking, downloading, checkNow, downloadUpdate }
}
