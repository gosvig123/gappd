import { useEffect, useState } from 'react'
import type { ClerkAccountStatus } from '../../shared/account-contract'
import { Button, Card, cx, StatusPill } from './ui'

export function ClerkAccountPanel() {
  const [status, setStatus] = useState<ClerkAccountStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => loadStatus(setStatus, setError), [])
  const run = async (action: () => Promise<ClerkAccountStatus>) => {
    setBusy(true); setError(null)
    try { setStatus(await action()) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const connected = Boolean(status?.connected)
  return <Card className="settings-section"><div className="settings-section-head"><div><h2>Gappd account</h2><p>Optional identity for future cloud features.</p></div><StatusPill tone={connected ? 'success' : 'neutral'}>{connected ? 'Signed in' : 'Local mode'}</StatusPill></div>{status?.user ? <div className="oauth-account-list"><div className="oauth-account-row"><span className="oauth-account-copy"><strong>{status.user.name || status.user.email}</strong><span>{status.user.email}</span></span></div></div> : null}<div className={cx('status-note', error ? 'danger' : undefined)}>{error || accountNote(status)}</div><div className="actions-row">{connected ? <Button disabled={busy} onClick={() => void run(window.gappd.clerkAuth.disconnect)}>{busy ? 'Signing out…' : 'Sign out'}</Button> : <Button variant="primary" disabled={busy || status?.configured === false} onClick={() => void run(window.gappd.clerkAuth.connect)}>{busy ? 'Waiting for browser…' : 'Sign in or create account'}</Button>}</div></Card>
}

function loadStatus(setStatus: (status: ClerkAccountStatus) => void, setError: (error: string) => void) {
  let active = true
  window.gappd.clerkAuth.status().then((status) => { if (active) setStatus(status) }).catch((cause) => { if (active) setError(errorMessage(cause)) })
  return () => { active = false }
}

function accountNote(status: ClerkAccountStatus | null): string {
  if (!status) return 'Checking account status…'
  if (!status.configured) return 'Clerk is not configured for this build. Local mode remains available.'
  if (status.connected) return 'Your local data remains on this Mac unless you enable a future cloud feature.'
  return 'No account is required for recording, history, settings, or Google Calendar.'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
