import { useEffect, useState } from 'react'
import { getLocalAIContract, toStatusError, type LocalAIStatus, type OnboardingStatus } from '../components/local-ai-contract'
import { useRequestGate } from './request-gate'

const localAI = getLocalAIContract()

export function useLocalAISettings(enabled: boolean, onOnboardingStatus: (status: OnboardingStatus) => void) {
  const request = useRequestGate()
  const [status, setStatus] = useState<LocalAIStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (enabled) void loadStatus()
    if (!enabled) stopLoading()
  }, [enabled])

  async function loadStatus() {
    const requestId = request.next()
    setLoading(true)
    try {
      const nextStatus = await localAI.settings.getLocalAIStatus()
      if (request.isCurrent(requestId)) setStatus(nextStatus)
    } catch (err) {
      if (request.isCurrent(requestId)) setStatus(toStatusError(err))
    } finally {
      if (request.isCurrent(requestId)) setLoading(false)
    }
  }

  async function repair() {
    setBusy(true)
    try {
      const nextStatus = await localAI.settings.repairLocalAI()
      setStatus(nextStatus)
      onOnboardingStatus(nextStatus)
    } catch (err) {
      setStatus(toStatusError(err))
    } finally {
      setBusy(false)
    }
  }

  function stopLoading() {
    request.cancel()
    setLoading(false)
  }

  return { status, loading, busy, repair }
}
