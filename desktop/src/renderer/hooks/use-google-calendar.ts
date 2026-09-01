import { useCallback, useEffect, useState } from 'react'
import type { CalendarSnapshot } from '../../shared/calendar-contract'

const CONNECT_OPERATION = 'connect'
const SYNC_ALL_OPERATION = 'sync-all'

export type GoogleCalendarController = {
  snapshot: CalendarSnapshot | null
  loading: boolean
  busy: string | null
  error: string | null
  connect(): Promise<void>
  sync(connectionId: string): Promise<void>
  syncAll(): Promise<void>
  disconnect(connectionId: string): Promise<void>
  clearError(): void
}

export function useGoogleCalendar(): GoogleCalendarController {
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.gappd.googleCalendar.snapshot()
      .then((value) => { if (active) setSnapshot(value) })
      .catch((cause) => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const run = useCallback(async (operation: string, action: () => Promise<CalendarSnapshot>) => {
    setBusy(operation); setError(null)
    try { setSnapshot(await action()) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }, [])

  const connect = useCallback(() => run(CONNECT_OPERATION, () => window.gappd.googleCalendar.connect()), [run])
  const sync = useCallback((id: string) => run(`sync:${id}`, () => window.gappd.googleCalendar.sync(id)), [run])
  const disconnect = useCallback((id: string) => run(`disconnect:${id}`, () => window.gappd.googleCalendar.disconnect(id)), [run])
  const syncAll = useCallback(() => run(SYNC_ALL_OPERATION, () => refreshAll(snapshot, setSnapshot)), [run, snapshot])
  return { snapshot, loading, busy, error, connect, sync, syncAll, disconnect, clearError: () => setError(null) }
}

async function refreshAll(snapshot: CalendarSnapshot | null, onProgress: (value: CalendarSnapshot) => void): Promise<CalendarSnapshot> {
  let latest = snapshot || await window.gappd.googleCalendar.snapshot()
  const failures: string[] = []
  for (const connection of latest.connections) {
    try {
      latest = await window.gappd.googleCalendar.sync(connection.id)
      onProgress(latest)
    } catch { failures.push(connection.email) }
  }
  if (failures.length) throw new Error(`Could not refresh: ${failures.join(', ')}.`)
  return latest
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
