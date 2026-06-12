import { useState } from 'react'
import type { UpdateStatus } from '../../shared/contracts'
import { useGuardedEffect } from './use-guarded-effect'

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useGuardedEffect((guard) => {
    window.gappd.update.getStatus()
      .then((next) => guard(() => setStatus(next.available ? next : null)))
      .catch(() => guard(() => setStatus(null)))
  }, [])
  return status
}
