import type { SlackConnectionController } from '../hooks/use-slack-connection'
import { SlackComposer } from './slack-composer'
import { Button, Card, StatusPill } from './ui'

export function SlackPanel({ slack }: { slack: SlackConnectionController }) {
  const status = slack.status
  const connected = status?.connected ?? false
  const expired = connected && Boolean(status?.refreshExpiresAt && status.refreshExpiresAt <= Date.now())
  const busy = Boolean(slack.busy)
  const disconnect = () => {
    if (!window.confirm('Disconnect Slack?\n\nGappd removes the Slack token from this Mac. Meetings stay on this Mac.')) return
    void slack.disconnect()
  }
  return (
    <Card className="settings-section">
      <div className="settings-section-head"><div><h2>Slack</h2><p>Connect Gappd to your Slack workspace and send messages you confirm as yourself.</p></div><StatusPill tone={statusTone(slack, expired)}>{statusLabel(slack, expired)}</StatusPill></div>
      <div className={slack.error || expired ? 'status-note danger' : 'status-note'} role={slack.error ? 'alert' : undefined}>{slack.error || connectionNote(slack, expired)}</div>
      <div className="actions-row">
        <Button variant="primary" disabled={!status?.configured || slack.loading || busy} onClick={() => void slack.connect()}>{connectLabel(slack, connected)}</Button>
        {connected ? <Button disabled={busy} onClick={disconnect}>{slack.busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</Button> : null}
      </div>
      {connected && !busy && !expired ? <SlackComposer key={`${status?.teamId}:${status?.userId}`} accountKey={`${status?.teamId ?? ''}:${status?.userId ?? ''}`} /> : null}
    </Card>
  )
}

function statusLabel(slack: SlackConnectionController, expired: boolean): string {
  if (slack.loading) return 'Checking'
  if (!slack.status?.configured) return 'Not configured'
  if (!slack.status.connected) return 'Not connected'
  return expired ? 'Reconnect needed' : 'Connected'
}

function statusTone(slack: SlackConnectionController, expired: boolean): string {
  if (slack.error || expired) return 'danger'
  if (slack.loading || slack.busy) return 'processing'
  return slack.status?.connected ? 'success' : 'neutral'
}

function connectionNote(slack: SlackConnectionController, expired: boolean): string {
  if (!slack.status?.configured) return 'Slack is not configured for this build.'
  if (!slack.status.connected) return 'Gappd opens Slack in your browser to request permission to send confirmed messages and list channels, conversations, and member names. Message history is not read. Tokens are encrypted on this Mac.'
  if (expired) return 'The Slack authorization expired. Reconnect Slack to continue.'
  return `Connected to ${slack.status.teamName || slack.status.teamId}. Gappd sends a message only after you review it and confirm it.`
}

function connectLabel(slack: SlackConnectionController, connected: boolean): string {
  if (slack.busy === 'connect') return 'Waiting for Slack…'
  return connected ? 'Reconnect Slack' : 'Connect Slack'
}
