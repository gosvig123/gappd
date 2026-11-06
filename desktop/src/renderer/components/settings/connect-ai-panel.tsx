import { useEffect, useState } from 'react'
import type { AIAppState } from '../../../shared/ai-apps'
import { REMOTE_AI_SERVICES, type RemoteAccessState, type RemoteAccessStatus, type RemoteAIServiceId } from '../../../shared/remote-access'
import { useAIApps } from '../../hooks/use-ai-apps'
import { errorText } from '../person-forms'
import { Button, Card, cx } from '../ui'

// The relay connection and a service's first use change on their own, so the panel checks again while open.
const REFRESH_MS = 3_000

// What the user still does in each service after Gappd opens it.
const NEXT_STEP: Record<RemoteAIServiceId, string> = {
  claude: 'Claude opens with Gappd filled in. Choose Add, then Connect, and sign in to allow Gappd. If the form is empty, choose Add custom connector and paste the server URL below.',
  chatgpt: 'The server URL is copied. In ChatGPT, select + and Add custom MCP server, name it Gappd, paste the URL and keep OAuth. Accept the warning, create the plugin, install it, and sign in to allow Gappd.',
}

/** One place to connect AI apps on this Mac and AI services on the web and phone to Gappd. */
export function ConnectAIPanel() {
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>Connect an AI</h2><p>Let an AI app search and read your Meetings when you ask it. It sends what it reads to its own AI service.</p></div></div>
      <LocalApps />
      <RemoteServices />
    </Card>
  )
}

function LocalApps() {
  const { apps, busy, error, restart, change, checkAgain } = useAIApps()
  const note = error || (restart ? `If ${restart} is open, quit and reopen it to load the change.` : null)
  const installed = (apps ?? []).filter((app) => app.state !== 'missing')
  const missing = (apps ?? []).filter((app) => app.state === 'missing')
  return (
    <section className="connect-ai-group" aria-labelledby="connect-ai-local">
      <h3 id="connect-ai-local">Apps on this Mac</h3>
      {installed.map((app) => (
        <div className="startup-setting ai-app-row" key={app.id}>
          <span className="startup-setting-copy"><strong>{app.name}</strong><span className={app.state === 'error' ? 'danger' : undefined}>{app.error ?? appStateText(app.state)}</span></span>
          {app.state === 'error'
            ? <Button variant="secondary" aria-label={`Check ${app.name} again`} disabled={busy !== null} onClick={() => void checkAgain(app)}>{busy === app.id ? 'Checking…' : 'Check again'}</Button>
            : <Button variant={app.state === 'on' ? 'secondary' : 'primary'} aria-label={`${appButtonText(app.state)} ${app.name}`} disabled={busy !== null} onClick={() => void change(app)}>{busy === app.id ? 'Working…' : appButtonText(app.state)}</Button>}
        </div>
      ))}
      {apps && missing.length > 0 ? (
        <p className="connect-ai-hint">{installed.length ? 'Also works with' : 'No supported app found. Install'} {missing.map((app) => app.name).join(', ')}{installed.length ? '.' : ' to connect it here.'} These apps run Gappd on this Mac, so they need no Gappd Cloud connection.</p>
      ) : null}
      {(note || !apps) && <div className={cx('status-note', error ? 'danger' : undefined)}>{note || 'Checking AI apps…'}</div>}
    </section>
  )
}

function RemoteServices() {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [busy, setBusy] = useState<RemoteAIServiceId | 'relay' | null>(null)
  const [added, setAdded] = useState<RemoteAIServiceId | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const load = () => window.gappd.remoteAccess.status()
      .then((next) => { if (active) { setStatus(next); setLoadError(null) } })
      .catch((cause) => { if (active) setLoadError(failure('Could not check remote access', cause, 'Gappd tries again in a few seconds.')) })
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const run = async (key: RemoteAIServiceId | 'relay', action: () => Promise<RemoteAccessStatus>, failed: string) => {
    setBusy(key)
    try {
      setStatus(await action())
      setError(null)
      return true
    } catch (cause) {
      setError(failure(failed, cause, 'Try again.'))
      return false
    } finally {
      setBusy(null)
    }
  }
  const add = async (id: RemoteAIServiceId, name: string) => {
    if (await run(id, () => window.gappd.remoteAccess.addToService(id), `Could not open ${name}`)) setAdded(id)
  }
  const setEnabled = (enabled: boolean) => run('relay', () => window.gappd.remoteAccess.setEnabled(enabled), `Could not turn remote access ${enabled ? 'on' : 'off'}`)
  return (
    <section className="connect-ai-group" aria-labelledby="connect-ai-remote">
      <h3 id="connect-ai-remote">On the web and phone</h3>
      {status ? REMOTE_AI_SERVICES.map((service) => {
        const lastUsed = status.lastUsed[service.id]
        const connected = Boolean(lastUsed && status.enabled)
        return (
          <div className="connect-ai-service" key={service.id}>
            <div className="startup-setting ai-app-row">
              <span className="startup-setting-copy"><strong>{service.name}</strong><span className={connected ? 'connect-ai-connected' : undefined}>{serviceText(status, service.name, lastUsed)}</span></span>
              <Button variant={connected ? 'secondary' : 'primary'} disabled={busy !== null} onClick={() => void add(service.id, service.name)}>
                {busy === service.id ? 'Opening…' : `Add to ${service.name}`}
              </Button>
            </div>
            {added === service.id && !connected ? <p className="connect-ai-hint" role="status">{NEXT_STEP[service.id]}</p> : null}
          </div>
        )
      }) : null}
      {status ? <RelayRow status={status} busy={busy === 'relay'} disabled={busy !== null} onEnable={() => void setEnabled(true)} onDisable={() => void setEnabled(false)} onError={setError} /> : null}
      {!status && !loadError ? <div className="status-note">Checking remote access…</div> : null}
      <div className="status-note">Meetings stay on this Mac, and services can read them only while Gappd is open. Gappd Cloud passes each request on and stores nothing, but it can see a request and its answer while it passes them on. These services can list, search and read Meetings; they cannot run database queries.</div>
      {loadError || error ? <div className={cx('status-note', 'danger')} role="alert">{error ?? loadError}</div> : null}
    </section>
  )
}

function RelayRow({ status, busy, disabled, onEnable, onDisable, onError }: {
  status: RemoteAccessStatus; busy: boolean; disabled: boolean; onEnable: () => void; onDisable: () => void; onError: (message: string) => void
}) {
  const problem = status.state === 'offline' || status.state === 'replaced'
  const button = !status.enabled ? 'Turn on' : status.state === 'replaced' ? 'Use this Mac' : 'Turn off'
  return (
    <div className="connect-ai-service">
      <div className="startup-setting ai-app-row">
        <span className="startup-setting-copy"><strong>Remote access</strong><span className={problem ? 'danger' : undefined}>{relayText(status.state)}</span></span>
        <Button variant="secondary" disabled={disabled} onClick={!status.enabled || status.state === 'replaced' ? onEnable : onDisable}>{busy ? 'Working…' : button}</Button>
      </div>
      <p className="connect-ai-hint">Server URL for Claude, ChatGPT or another AI service:</p>
      <CopyValue label="server URL" value={status.address} onError={onError} />
    </div>
  )
}

function CopyValue({ label, value, onError }: { label: string; value: string; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch (cause) {
      onError(failure(`Could not copy the ${label}`, cause, 'Select the text and copy it by hand.'))
    }
  }
  return (
    <span className="connect-ai-copy">
      <code>{value}</code>
      <Button variant="secondary" aria-label={`${copied ? 'Copied' : 'Copy'} ${label}`} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
    </span>
  )
}

function failure(operation: string, cause: unknown, recovery: string): string {
  const reason = errorText(cause).trim()
  return `${operation}: ${reason}${/[.!?]$/.test(reason) ? '' : '.'} ${recovery}`
}

function serviceText(status: RemoteAccessStatus, name: string, lastUsed: string | undefined): string {
  if (lastUsed && status.enabled) return `Connected. Last used ${timeAgo(lastUsed)}.`
  if (lastUsed) return `Remote access is off. ${name} last used Gappd ${timeAgo(lastUsed)}.`
  return 'Not connected.'
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `on ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function relayText(state: RemoteAccessState): string {
  if (state === 'signed-out') return 'Needs your Gappd account. Sign in under Cloud Meeting sync below.'
  if (state === 'connecting') return 'Connecting to Gappd Cloud…'
  if (state === 'connected') return 'On. Services you added can read your Meetings while Gappd is open.'
  if (state === 'offline') return 'Cannot reach Gappd Cloud. Gappd tries again automatically.'
  if (state === 'replaced') return 'Another Mac with this account turned on remote access, so this Mac stopped.'
  return 'Off. Adding a service turns it on.'
}

function appStateText(state: AIAppState): string {
  if (state === 'on') return 'Connected. It can search and read your Meetings.'
  if (state === 'outdated') return 'Connected with old settings. Update to fix it.'
  return 'Not connected.'
}

function appButtonText(state: AIAppState): string {
  if (state === 'on') return 'Disconnect'
  return state === 'outdated' ? 'Update' : 'Connect'
}
