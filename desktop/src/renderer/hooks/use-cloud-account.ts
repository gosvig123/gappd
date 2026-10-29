import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { CloudAuthStatus } from '../../shared/cloud-auth-contract'
import type { AppView } from '../lib/app-view'

type Snapshot = { account: CloudAuthStatus | null; connecting: boolean; error: string | null }

const REFRESH_MS = 3000
let snapshot: Snapshot = { account: null, connecting: false, error: null }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let reads = 0
let attempts = 0

function publish(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

/** A newer read or action makes an older read stale, so a slow status never overwrites it. */
async function refresh(): Promise<void> {
  const id = ++reads
  try {
    const account = (await window.gappd.meetingUpload.status()).account
    if (id === reads) publish({ account })
  } catch { /* the next read retries */ }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refresh()
    // Settings signs in and out through its own panel, so every user of the account polls.
    timer = setInterval(() => void refresh(), REFRESH_MS)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) clearInterval(timer)
  }
}

async function signIn(): Promise<boolean> {
  const attempt = ++attempts
  reads++
  publish({ connecting: true, error: null })
  try {
    const account = (await window.gappd.meetingUpload.connect(true)).account
    // After Cancel, a late result only updates the status; it does not go on to Calendar.
    if (attempt !== attempts) { void refresh(); return false }
    reads++
    publish({ account, connecting: false, error: account.error })
    return Boolean(account.email)
  } catch {
    publish({ connecting: false, error: 'Gappd could not open the sign-in. Check your connection and try again.' })
    return false
  }
}

/**
 * Stops a sign-in that waits in the browser. connect(false) is also sign-out, so it first
 * reads the status and keeps an account whose sign-in has already finished.
 */
async function cancel(): Promise<void> {
  if (!snapshot.connecting && !snapshot.account?.pending) return
  attempts++
  reads++
  publish({ connecting: false })
  try {
    const current = (await window.gappd.meetingUpload.status()).account
    publish({ account: current.email ? current : (await window.gappd.meetingUpload.connect(false)).account })
  } catch { /* the next read shows the result */ }
}

/**
 * The Gappd account on this Mac, shared by every view that asks for one. account is null
 * while it loads. Sign-in opens the browser and resolves when it ends; it never turns on
 * Meeting sync.
 */
export function useCloudAccount() {
  const state = useSyncExternalStore(subscribe, () => snapshot)
  // The main process reports pending only in a status read during the sign-in, so show it from here too.
  const account = state.connecting && state.account ? { ...state.account, pending: true } : state.account
  return { account, connecting: state.connecting, error: state.error ?? state.account?.error ?? null, signIn, cancel }
}

/**
 * Signs in to Gappd, then connects Google Calendar when it is still not connected. It reads
 * the Calendar state after the sign-in, because it can load or change while the browser is open.
 */
export function useContinueWithGoogle(view: AppView, onSignedIn: () => void): () => Promise<void> {
  const latest = useRef(view)
  useEffect(() => { latest.current = view })
  return useCallback(async () => {
    if (!await signIn()) return
    onSignedIn()
    const calendar = latest.current.calendar
    if (calendar?.configured && !calendar.connections.length && !latest.current.calendarBusy) await latest.current.actions.connectCalendar()
  }, [onSignedIn])
}
