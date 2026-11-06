import { useEffect, useRef, useState } from 'react'
import type { AIAppState } from '../../../shared/ai-apps'
import { REMOTE_AI_SERVICES, type RemoteAccessState, type RemoteAccessStatus, type RemoteAIServiceId } from '../../../shared/remote-access'
import { useAIApps } from '../../hooks/use-ai-apps'
import { errorText } from '../person-forms'
import { Button, Card, cx } from '../ui'

// The relay connection and a service's first use change on their own, so the panel checks again while open.
const REFRESH_MS = 3_000

// Where each account works, and what the install asks of the user, shown before they start it.
const SERVICE_TEXT: Record<RemoteAIServiceId, { where: string; install: string; opened: string }> = {
  claude: {
    where: 'On claude.ai and in the Claude apps for phone and desktop.',
    install: 'Opens claude.ai with Gappd filled in. Choose Add, then Connect, then Allow on the Gappd sign-in page.',
    opened: 'Opened Claude in your browser. If its form is empty, choose Add custom connector and paste the server URL below.',
  },
  chatgpt: {
    where: 'On chatgpt.com and in the ChatGPT apps for phone and desktop.',
    install: 'Copies the server URL and opens ChatGPT. Choose +, then Add custom MCP server, name it Gappd and paste the URL. Then create and install it, and choose Allow on the Gappd sign-in page.',
    opened: 'Opened ChatGPT in your browser. The server URL is on your clipboard.',
  },
}

// Short descriptions so the user can tell the apps on this Mac from the accounts below.
const APP_KIND: Record<string, string> = {
  claude_desktop: 'The Claude app for Mac.',
  claude_code: 'Claude in the terminal.',
  codex: 'The Codex app and command line.',
}

/** One place to connect AI apps on this Mac, and Claude and ChatGPT accounts, to Gappd. */
export function ConnectAIPanel() {
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>Connect an AI</h2><p>Ask an AI about your Meetings. It can search and read them when you ask, and sends what it reads to its own AI service. Choose where you use the AI.</p></div></div>
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
      <p className="connect-ai-intro">One click. Gappd adds itself to the app, and the app reads Meetings straight from this Mac. No Gappd Cloud needed.</p>
      {installed.map((app) => (
        <div className="startup-setting ai-app-row" key={app.id}>
          <span className="startup-setting-copy"><strong>{app.name}</strong><span className={app.state === 'error' ? 'danger' : undefined}>{app.error ?? `${APP_KIND[app.id] ?? ''} ${appStateText(app.state)}`.trim()}</span></span>
          {app.state === 'error'
            ? <Button variant="secondary" aria-label={`Check ${app.name} again`} disabled={busy !== null} onClick={() => void checkAgain(app)}>{busy === app.id ? 'Checking…' : 'Check again'}</Button>
            : <Button variant={app.state === 'on' ? 'secondary' : 'primary'} aria-label={`${appButtonText(app.state)} ${app.name}`} disabled={busy !== null} onClick={() => void change(app)}>{busy === app.id ? 'Working…' : appButtonText(app.state)}</Button>}
        </div>
      ))}
      {apps && missing.length > 0 ? (
        <p className="connect-ai-hint">{installed.length ? 'Also works with' : 'No supported app found. Install'} {missing.map((app) => app.name).join(', ')}{installed.length ? ' when installed.' : ' to connect it here.'}</p>
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
  // Each status request gets a number, so a slow poll cannot overwrite the answer to a later action.
  const latest = useRef(0)
  useEffect(() => {
    let active = true
    const load = () => {
      const request = ++latest.current
      return window.gappd.remoteAccess.status()
        .then((next) => { if (active && request === latest.current) { setStatus(next); setLoadError(null) } })
        .catch((cause) => { if (active && request === latest.current) setLoadError(failure('Could not check remote access', cause, 'Gappd tries again in a few seconds.')) })
    }
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const run = async (key: RemoteAIServiceId | 'relay', action: () => Promise<RemoteAccessStatus>, failed: string) => {
    setBusy(key)
    const request = ++latest.current
    try {
      const next = await action()
      if (request === latest.current) setStatus(next)
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
  const setEnabled = async (enabled: boolean) => {
    if (await run('relay', () => window.gappd.remoteAccess.setEnabled(enabled), `Could not turn remote access ${enabled ? 'on' : 'off'}`) && !enabled) setAdded(null)
  }
  return (
    <section className="connect-ai-group" aria-labelledby="connect-ai-remote">
      <h3 id="connect-ai-remote">Claude and ChatGPT accounts</h3>
      <p className="connect-ai-intro">Adds Gappd to your account, so it works wherever you sign in, including your phone. Requests reach this Mac through Gappd Cloud, so this Mac must be awake with Gappd open.</p>
      {status ? REMOTE_AI_SERVICES.map((service) => {
        const lastUsed = status.lastUsed[service.id]
        const connected = Boolean(lastUsed && status.enabled && (status.state === 'connected' || status.state === 'connecting'))
        const text = SERVICE_TEXT[service.id]
        const opened = added === service.id && !connected
        return (
          <div className="connect-ai-service" key={service.id}>
            <div className="startup-setting ai-app-row">
              <span className="startup-setting-copy"><strong>{service.name}</strong><span>{text.where}</span><span className={connected ? 'connect-ai-connected' : undefined}>{serviceText(connected, service.name, lastUsed)}</span></span>
              <Button variant={connected ? 'secondary' : 'primary'} disabled={busy !== null} onClick={() => void add(service.id, service.name)}>
                {busy === service.id ? 'Opening…' : `Add to ${service.name}`}
              </Button>
            </div>
            {connected ? null : <p className="connect-ai-hint">{text.install}</p>}
            <p className="connect-ai-hint connect-ai-status" role="status">
              {opened ? `${text.opened}${status.state === 'signed-out' ? ' Sign in under Cloud Meeting sync below first, or it cannot reach this Mac.' : ''}` : ''}
            </p>
          </div>
        )
      }) : null}
      {status ? <RelayRow status={status} busy={busy === 'relay'} disabled={busy !== null} onEnable={() => void setEnabled(true)} onDisable={() => void setEnabled(false)} onError={setError} onCopied={() => setError(null)} /> : null}
      {!status && !loadError ? <div className="status-note">Checking remote access…</div> : null}
      <div className="status-note">Meetings stay on this Mac. Claude and ChatGPT can list, search and read them, but cannot run database queries. Gappd Cloud passes each request on and stores nothing, but it can see a request and its answer while it passes them on.</div>
      {loadError || error ? <div className={cx('status-note', 'danger')} role="alert">{error ?? loadError}</div> : null}
    </section>
  )
}

function RelayRow({ status, busy, disabled, onEnable, onDisable, onError, onCopied }: {
  status: RemoteAccessStatus; busy: boolean; disabled: boolean; onEnable: () => void; onDisable: () => void; onError: (message: string) => void; onCopied: () => void
}) {
  const problem = status.state === 'offline' || status.state === 'replaced'
  // Another Mac took over: the saved setting is off, but the choice to make is to use this Mac again.
  const enable = status.state === 'replaced' || !status.enabled
  const button = status.state === 'replaced' ? 'Use this Mac' : enable ? 'Turn on' : 'Turn off'
  return (
    <div className="connect-ai-service">
      <div className="startup-setting ai-app-row">
        <span className="startup-setting-copy"><strong>Remote access</strong><span>Lets your Claude and ChatGPT accounts reach this Mac.</span><span className={problem ? 'danger' : undefined}>{relayText(status.state)}</span></span>
        <Button variant="secondary" disabled={disabled} onClick={enable ? onEnable : onDisable}>{busy ? 'Working…' : button}</Button>
      </div>
      <p className="connect-ai-hint">Server URL, for another AI service or if a form is empty:</p>
      <CopyValue label="server URL" value={status.address} onError={onError} onCopied={onCopied} />
    </div>
  )
}

function CopyValue({ label, value, onError, onCopied }: { label: string; value: string; onError: (message: string) => void; onCopied: () => void }) {
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
      onCopied()
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

function serviceText(connected: boolean, name: string, lastUsed: string | undefined): string {
  if (connected && lastUsed) return `Connected. Last used ${timeAgo(lastUsed)}.`
  if (lastUsed) return `${name} last used Gappd ${timeAgo(lastUsed)}. See Remote access below.`
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
  return 'Off. Add to Claude or Add to ChatGPT turns it on.'
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
