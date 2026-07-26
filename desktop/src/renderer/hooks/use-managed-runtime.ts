import { useEffect, useState } from 'react'
import { MANAGED_LLAMACPP_MODEL, isManagedLlamaCppModel, type ManagedLlamaCppModelTag } from '../../shared/managed-local-ai'
import { getManagedRuntimeContract, toStatusError, type ManagedRuntimeSnapshot } from '../components/managed-runtime-contract'
import { useGuardedEffect } from './use-guarded-effect'

export function useManagedRuntime() {
  const runtime = getManagedRuntimeContract().managedRuntime
  const [status, setStatus] = useState<ManagedRuntimeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ManagedLlamaCppModelTag>(MANAGED_LLAMACPP_MODEL)
  useRuntimeSnapshot(runtime, setStatus, setLoading)
  useSelectedModel(status, busy, setSelectedModel)

  async function prepare(mode: 'setup' | 'repair') {
    setBusy(true)
    try { setStatus(await runtime.prepare({ mode, model: selectedModel })) }
    catch (error) { setStatus(toStatusError(error)) }
    finally { setBusy(false) }
  }

  return { status, loading, busy, selectedModel, setSelectedModel, prepare }
}

function useRuntimeSnapshot(runtime: ReturnType<typeof getManagedRuntimeContract>['managedRuntime'], setStatus: (value: ManagedRuntimeSnapshot) => void, setLoading: (value: boolean) => void): void {
  useGuardedEffect((guard) => {
    const dispose = runtime.observe((snapshot) => guard(() => setStatus(snapshot)))
    void loadSnapshot(runtime, (snapshot) => guard(() => setStatus(snapshot)), () => guard(() => setLoading(false)))
    return dispose
  }, [])
}

async function loadSnapshot(runtime: ReturnType<typeof getManagedRuntimeContract>['managedRuntime'], setStatus: (value: ManagedRuntimeSnapshot) => void, done: () => void): Promise<void> {
  try { setStatus(await runtime.status()) }
  catch (error) { setStatus(toStatusError(error)) }
  finally { done() }
}

function useSelectedModel(status: ManagedRuntimeSnapshot | null, busy: boolean, setModel: (model: ManagedLlamaCppModelTag) => void): void {
  useEffect(() => {
    if (!busy && status && isManagedLlamaCppModel(status.model)) setModel(status.model)
  }, [status?.model, busy])
}
