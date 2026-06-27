import { useCallback, useState } from 'react'
import type { UpdateStatus } from '../../shared/contracts'
import { useGuardedEffect } from './use-guarded-effect'

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const applyStatus = useCallback((next: UpdateStatus) => { setStatus(next); return next }, [])
  const checkNow = useCallback(async () => applyStatus(await window.gappd.update.checkNow()), [applyStatus])
  const downloadUpdate = useCallback(async () => applyStatus(await window.gappd.update.downloadUpdate()), [applyStatus])
  const installAndRestart = useCallback(async () => applyStatus(await window.gappd.update.installAndRestart()), [applyStatus])
  const openUpdatePage = useCallback(() => window.gappd.update.openUpdatePage(), [])
  useUpdateSubscription(applyStatus)
  return { status, checking: status?.phase === 'checking', downloading: status?.phase === 'downloading', checkNow, downloadUpdate, installAndRestart, openUpdatePage }
}

function useUpdateSubscription(applyStatus: (next: UpdateStatus) => UpdateStatus): void {
  useGuardedEffect((guard) => {
    window.gappd.update.getStatus().then((next) => guard(() => applyStatus(next)))
    return window.gappd.update.onStatusChanged((next) => guard(() => applyStatus(next)))
  }, [applyStatus])
}
