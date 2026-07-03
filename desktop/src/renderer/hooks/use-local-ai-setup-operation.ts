import { useEffect, useState } from 'react'
import { MANAGED_LLAMACPP_MODEL, isManagedLlamaCppModel, type ManagedLlamaCppModelTag } from '../../shared/managed-local-ai'
import { getLocalAIContract, toStatusError, type LocalAISetupStatus } from '../components/local-ai-contract'
import { useGuardedEffect } from './use-guarded-effect'

const localAI = getLocalAIContract()

export function useLocalAISetupOperation() {
  const [status, setStatus] = useState<LocalAISetupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ManagedLlamaCppModelTag>(MANAGED_LLAMACPP_MODEL)

  useLocalAISetupStatus(setStatus, setLoading)
  useSelectedManagedModel(status, busy, setSelectedModel)

  async function run(action: 'start' | 'retry') {
    setBusy(true)
    try {
      const input = { model: selectedModel }
      setStatus(action === 'start' ? await localAI.localAISetup.start(input) : await localAI.localAISetup.retry(input))
    } catch (err) {
      setStatus(toStatusError(err))
    } finally {
      setBusy(false)
    }
  }

  return { status, loading, busy, selectedModel, setSelectedModel, run, setStatus }
}

function useLocalAISetupStatus(onStatus: (status: LocalAISetupStatus) => void, onLoading: (loading: boolean) => void) {
  useGuardedEffect((guard) => {
    const dispose = localAI.localAISetup.onStatusChanged((status) => guard(() => onStatus(status)))
    void loadInitialStatus((status) => guard(() => onStatus(status)), () => guard(() => onLoading(false)))
    return dispose
  }, [])
}

async function loadInitialStatus(onStatus: (status: LocalAISetupStatus) => void, onDone: () => void) {
  try {
    onStatus(await localAI.localAISetup.getStatus())
  } catch (err) {
    onStatus(toStatusError(err))
  } finally {
    onDone()
  }
}

function useSelectedManagedModel(status: LocalAISetupStatus | null, busy: boolean, setModel: (model: ManagedLlamaCppModelTag) => void) {
  useEffect(() => {
    if (!busy && status && isManagedLlamaCppModel(status.model)) setModel(status.model)
  }, [status?.model, busy])
}
