import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from 'react'
import type { TranscriptionSettings, WhisperModelDownloadProgress } from '../../shared/ipc-contract'

type RequestState = {
  settings: TranscriptionSettings | null
  loading: boolean
  busyModelId: string | null
  error: string | null
  progress: WhisperModelDownloadProgress | null
}

export function useTranscriptionSettings(enabled: boolean) {
  const [state, setState] = useState<RequestState>({ settings: null, loading: false, busyModelId: null, error: null, progress: null })
  const refresh = useCallback(() => loadSettings(setState), [])
  const download = useCallback((id: string) => runModelAction(id, setState, window.gappd.settings.downloadWhisperModel), [])
  const setDefault = useCallback((id: string) => runModelAction(id, setState, window.gappd.settings.setDefaultWhisperModel), [])

  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])
  useEffect(() => enabled ? window.gappd.settings.onWhisperModelDownloadProgress((progress) => {
    setState((current) => ({ ...current, progress, busyModelId: progress.modelId }))
  }) : undefined, [enabled])

  return useMemo(() => ({ ...state, refresh, download, setDefault }), [state, refresh, download, setDefault])
}

async function loadSettings(setState: Dispatch<SetStateAction<RequestState>>) {
  setState((current) => ({ ...current, loading: true, error: null }))
  try {
    const settings = await window.gappd.settings.getTranscriptionSettings()
    setState((current) => ({ ...current, settings, loading: false }))
  } catch (error) {
    setState((current) => ({ ...current, loading: false, error: errorMessage(error) }))
  }
}

async function runModelAction(id: string, setState: Dispatch<SetStateAction<RequestState>>, action: (id: string) => Promise<TranscriptionSettings>) {
  setState((current) => ({ ...current, busyModelId: id, error: null }))
  try {
    const settings = await action(id)
    setState((current) => ({ ...current, settings, busyModelId: null, progress: null }))
  } catch (error) {
    setState((current) => ({ ...current, busyModelId: null, progress: null, error: errorMessage(error) }))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
