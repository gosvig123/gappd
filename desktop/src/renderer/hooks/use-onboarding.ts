import { useEffect, useState } from 'react'
import { MANAGED_OLLAMA_MODEL, isManagedOllamaModel, type ManagedOllamaModelTag } from '../../shared/bundled-ollama'
import { getLocalAIContract, toStatusError, type OnboardingStatus } from '../components/local-ai-contract'

const localAI = getLocalAIContract()

export function useOnboarding() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ManagedOllamaModelTag>(MANAGED_OLLAMA_MODEL)

  useOnboardingStatus(setStatus, setLoading)
  useSelectedManagedModel(status, busy, setSelectedModel)

  async function run(action: 'start' | 'retry') {
    setBusy(true)
    try {
      const input = { model: selectedModel }
      setStatus(action === 'start' ? await localAI.onboarding.start(input) : await localAI.onboarding.retry(input))
    } catch (err) {
      setStatus(toStatusError(err))
    } finally {
      setBusy(false)
    }
  }

  return { status, loading, busy, selectedModel, setSelectedModel, run, setStatus }
}

function useOnboardingStatus(onStatus: (status: OnboardingStatus) => void, onLoading: (loading: boolean) => void) {
  useEffect(() => {
    let disposed = false
    const dispose = localAI.onboarding.onStatusChanged((status) => { if (!disposed) onStatus(status) })
    void loadInitialStatus((status) => { if (!disposed) onStatus(status) }, () => { if (!disposed) onLoading(false) })
    return () => { disposed = true; dispose() }
  }, [])
}

async function loadInitialStatus(onStatus: (status: OnboardingStatus) => void, onDone: () => void) {
  try {
    onStatus(await localAI.onboarding.getStatus())
  } catch (err) {
    onStatus(toStatusError(err))
  } finally {
    onDone()
  }
}

function useSelectedManagedModel(status: OnboardingStatus | null, busy: boolean, setModel: (model: ManagedOllamaModelTag) => void) {
  useEffect(() => {
    if (!busy && status && isManagedOllamaModel(status.model)) setModel(status.model)
  }, [status?.model, busy])
}
