import type { CalendarConnection } from '../../shared/calendar-contract'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'
import { Button, Card, cx, StatusPill } from './ui'
import './google-calendar.css'

export function GoogleCalendarPanel({ calendar }: { calendar: GoogleCalendarController }) {
  const snapshot = calendar.snapshot
  const configured = snapshot?.configured ?? false
  const connections = snapshot?.connections || []
  const gmail = snapshot?.gmailAvailable ?? false
  const idle = !configured || calendar.loading || Boolean(calendar.busy)
  return <Card className="settings-section calendar-settings"><div className="settings-section-head"><div><h2>Google Calendar</h2><p>Connect work and personal accounts independently.</p></div><StatusPill tone={statusTone(calendar)}>{statusLabel(calendar)}</StatusPill></div><CalendarDisclosure />{connections.length ? <div className="calendar-account-list">{connections.map((connection) => <CalendarAccount key={connection.id} connection={connection} calendar={calendar} />)}</div> : <div className="status-note">{configured ? 'No Google accounts connected.' : 'Calendar access is not configured for this build.'}</div>}{calendar.error ? <div className="status-note danger" role="alert">{calendar.error}</div> : null}<p>{gmail ? GMAIL_DISCLOSURE : 'Gmail access is unavailable pending separate approval.'} Disconnect removes this account's Calendar cache; recorded Meetings stay on this Mac.</p><div className="actions-row"><Button variant="primary" disabled={idle} onClick={() => void calendar.connect()}>{calendar.busy === 'connect' ? 'Connecting…' : connections.length ? 'Connect another account' : 'Connect Google Calendar'}</Button>{gmail ? <Button disabled={idle} onClick={() => void calendar.connect(true)}>Connect with Gmail read access</Button> : null}</div></Card>
}

const GMAIL_DISCLOSURE = 'Optional Gmail read access lets Agenda drafts and Meeting enrichment read recent email with a Meeting’s invitees from this account. Local AI processes it on this Mac only; it is never sent to Installed Codex or a server. Choose the same account to add access.'

function CalendarDisclosure() {
  return <div className="calendar-disclosure"><strong>Before you connect</strong><span>Gappd opens Google in your browser and requests read-only access to events you own on your primary calendar. It shows upcoming events, suggests event invitees for Meetings, and uses event details in Agenda drafts you request. Agenda drafts and Meeting enrichment that use Calendar context require Local AI on this Mac; Installed Codex cannot process that context. Availability-only access cannot provide these details. Tokens and cached events are encrypted on this Mac. Gappd’s isolated relay handles authorization data transiently; it does not store Google tokens or event data.</span></div>
}

function CalendarAccount({ connection, calendar }: { connection: CalendarConnection; calendar: GoogleCalendarController }) {
  const busy = Boolean(calendar.busy)
  const disconnect = () => {
    if (!window.confirm(`Disconnect ${connection.email}?\n\nCalendar events for this account will be removed from Gappd. Recorded meetings stay on this Mac.`)) return
    void calendar.disconnect(connection.id)
  }
  return <div className={cx('calendar-account', connection.status === 'error' && 'has-error')}><div><strong>{connection.email}</strong><span>{connectionNote(connection)}{connection.gmailEnabled ? ' · Gmail read access on' : ''}</span></div><div className="calendar-account-actions"><Button disabled={busy} onClick={() => void calendar.sync(connection.id)}>{calendar.busy === `sync:${connection.id}` ? 'Refreshing…' : 'Refresh'}</Button><Button disabled={busy} onClick={disconnect}>{calendar.busy === `disconnect:${connection.id}` ? 'Disconnecting…' : 'Disconnect'}</Button></div></div>
}

function connectionNote(connection: CalendarConnection): string {
  if (connection.error) return connection.error
  if (!connection.lastSyncedAt) return connection.status === 'syncing' ? 'Refreshing…' : 'Waiting for first refresh'
  const value = new Date(connection.lastSyncedAt)
  return Number.isNaN(value.getTime()) ? 'Previously refreshed' : `Refreshed ${value.toLocaleString()}`
}

function statusLabel(calendar: GoogleCalendarController): string {
  if (calendar.loading) return 'Checking'
  if (!calendar.snapshot?.configured) return 'Not configured'
  return calendar.snapshot.connections.length ? 'Connected' : 'Not connected'
}

function statusTone(calendar: GoogleCalendarController): string {
  if (calendar.error) return 'danger'
  if (calendar.loading || calendar.busy) return 'processing'
  return calendar.snapshot?.connections.length ? 'success' : 'neutral'
}
