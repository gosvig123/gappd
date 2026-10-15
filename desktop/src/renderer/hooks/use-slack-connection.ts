import { useCallback, useEffect, useState } from 'react'
import type { SlackConnectionStatus } from '../../shared/slack-contract'

const CONNECT_OPERATION = 'connect'
const DISCONNECT_OPERATION = 'disconnect'

export type SlackConnectionController = {
  status: SlackConnectionStatus | null
  loading: boolean
  busy: string | null
  error: string | null
  connect(): Promise<void>
  disconnect(): Promise<void>
  clearError(): void
}

export function useSlackConnection(): SlackConnectionController {
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => loadStatus(setStatus, setError, setLoading), [])

  const run = useCallback(async (operation: string, action: () => Promise<SlackConnectionStatus>) => {
    setBusy(operation); setError(null)
    try { setStatus(await action()) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }, [])

  const connect = useCallback(() => run(CONNECT_OPERATION, () => window.gappd.slack.connect()), [run])
  const disconnect = useCallback(() => run(DISCONNECT_OPERATION, () => window.gappd.slack.disconnect()), [run])
  return { status, loading, busy, error, connect, disconnect, clearError: () => setError(null) }
}

function loadStatus(setStatus: (value: SlackConnectionStatus) => void, setError: (value: string) => void, setLoading: (value: boolean) => void) {
  let active = true
  window.gappd.slack.status()
    .then((value) => { if (active) setStatus(value) })
    .catch((cause) => { if (active) setError(errorMessage(cause)) })
    .finally(() => { if (active) setLoading(false) })
  return () => { active = false }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
