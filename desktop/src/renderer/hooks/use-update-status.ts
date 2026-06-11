import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/contracts'

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let disposed = false
    window.gappd.update.getStatus()
      .then((next) => { if (!disposed) setStatus(next.available ? next : null) })
      .catch(() => { if (!disposed) setStatus(null) })
    return () => { disposed = true }
  }, [])
  return status
}
