import { useEffect, useState } from 'react'
import type { RemoteAccessState, RemoteAccessStatus } from '../../../shared/remote-access'
import { errorText } from '../person-forms'
import { Button, Card, cx } from '../ui'

// The connection changes on its own, so the panel checks it again while it is open.
const REFRESH_MS = 3_000

/** Lets AI services outside this Mac read Meetings through Gappd Cloud, which stores nothing. */
export function RemoteAccessPanel() {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const load = () => window.gappd.remoteAccess.status().then((next) => { if (active) setStatus(next) })
      .catch((cause) => { if (active) setError(`Could not check remote access: ${errorText(cause)}`) })
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const change = async (enabled: boolean) => {
    setBusy(true)
    try {
      setStatus(await window.gappd.remoteAccess.setEnabled(enabled))
      setError(null)
    } catch (cause) {
      setError(`Could not turn remote access ${enabled ? 'on' : 'off'}: ${errorText(cause)}`)
    } finally {
      setBusy(false)
    }
  }
  if (!status) return null
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>Remote access</h2><p>Let AI services outside this Mac, such as Claude on the web or on a phone, search and read your Meetings while Gappd is open.</p></div></div>
      <div className="startup-setting ai-app-row">
        <span className="startup-setting-copy"><strong>This Mac</strong><span className={status.state === 'offline' || status.state === 'replaced' ? 'danger' : undefined}>{stateText(status.state)}</span></span>
        <Button variant={status.enabled ? 'secondary' : 'primary'} disabled={busy} onClick={() => void change(!status.enabled)}>{busy ? 'Working…' : status.enabled ? 'Turn off' : 'Turn on'}</Button>
      </div>
      {status.enabled ? <div className="status-note">In your AI service, add a custom connector with this address, then sign in with your Gappd account: <code>{status.address}</code></div> : null}
      <div className="status-note">Meetings stay on this Mac. Gappd Cloud passes each request to this Mac and stores nothing, but it can see a request and its answer while it passes them on. Remote AI services can list, search and read Meetings; they cannot run database queries.</div>
      {error ? <div className={cx('status-note', 'danger')} role="alert">{error}</div> : null}
    </Card>
  )
}

function stateText(state: RemoteAccessState): string {
  if (state === 'signed-out') return 'Sign in under Cloud Meeting sync below. Remote access starts after you sign in.'
  if (state === 'connecting') return 'Connecting to Gappd Cloud…'
  if (state === 'connected') return 'On. AI services you connect can read your Meetings while Gappd is open.'
  if (state === 'offline') return 'Cannot reach Gappd Cloud. Gappd tries again automatically.'
  if (state === 'replaced') return 'Another Mac with this account turned on remote access. Turn it on again to use this Mac.'
  return 'Off.'
}
