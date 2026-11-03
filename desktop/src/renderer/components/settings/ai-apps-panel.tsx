import { useState } from 'react'
import type { AIAppId, AIAppState, AIAppStatus } from '../../../shared/ai-apps'
import { useGuardedEffect } from '../../hooks/use-guarded-effect'
import { errorText } from '../person-forms'
import { Button, Card, cx } from '../ui'

/** Connects AI apps on this Mac to the local Gappd MCP server. */
export function AIAppsPanel() {
  const [apps, setApps] = useState<AIAppStatus[] | null>(null)
  const [busy, setBusy] = useState<AIAppId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restart, setRestart] = useState<string | null>(null)
  useGuardedEffect((guard) => {
    window.gappd.aiApps.status().then((next) => guard(() => setApps(next)))
      .catch((cause) => guard(() => setError(`Could not check AI apps: ${errorText(cause)} Reopen Settings to try again.`)))
  }, [])
  const change = async (app: AIAppStatus) => {
    const connect = app.state !== 'on'
    setBusy(app.id)
    try {
      setApps(await (connect ? window.gappd.aiApps.connect(app.id) : window.gappd.aiApps.disconnect(app.id)))
      setError(null)
      setRestart(app.name)
    } catch (cause) {
      setRestart(null)
      setError(`Could not ${connect ? 'connect' : 'disconnect'} ${app.name}: ${errorText(cause)}`)
      await window.gappd.aiApps.status().then(setApps).catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }
  const checkAgain = async (app: AIAppStatus) => {
    setBusy(app.id)
    try {
      setApps(await window.gappd.aiApps.status())
      setError(null)
    } catch (cause) {
      setError(`Could not check AI apps: ${errorText(cause)}`)
    } finally {
      setBusy(null)
    }
  }
  const note = error || (restart ? `If ${restart} is open, quit and reopen it to load the change.` : null)
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>AI apps</h2><p>Let AI apps on this Mac search and read your Meetings. They run Gappd on this Mac, so no Gappd cloud connection is needed.</p></div></div>
      {(apps ?? []).map((app) => (
        <div className="startup-setting ai-app-row" key={app.id}>
          <span className="startup-setting-copy"><strong>{app.name}</strong><span className={app.state === 'error' ? 'danger' : undefined}>{app.error ?? stateText(app.state)}</span></span>
          {app.state === 'error' ? <Button variant="secondary" aria-label={`Check ${app.name} again`} disabled={busy !== null} onClick={() => void checkAgain(app)}>{busy === app.id ? 'Checking…' : 'Check again'}</Button> : app.state === 'missing' ? null : <Button variant={app.state === 'on' ? 'secondary' : 'primary'} aria-label={`${buttonText(app.state)} ${app.name}`} disabled={busy !== null} onClick={() => void change(app)}>{busy === app.id ? 'Working…' : buttonText(app.state)}</Button>}
        </div>
      ))}
      <div className="status-note">Meetings stay on this Mac. An AI app reads them through Gappd only when you ask it, and sends what it reads to its own AI service.</div>
      {(note || !apps) && <div className={cx('status-note', error ? 'danger' : undefined)}>{note || 'Checking AI apps…'}</div>}
    </Card>
  )
}

function stateText(state: AIAppState): string {
  if (state === 'missing') return 'Not installed on this Mac.'
  if (state === 'on') return 'Connected. It can search and read your Meetings.'
  if (state === 'outdated') return 'Connected with old settings. Update to fix it.'
  return 'Not connected.'
}

function buttonText(state: AIAppState): string {
  if (state === 'on') return 'Disconnect'
  return state === 'outdated' ? 'Update' : 'Connect'
}
