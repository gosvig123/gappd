import { useState } from 'react'
import type { CalendarConnection, GoogleAccess } from '../../../shared/calendar-contract'
import type { GoogleCalendarController } from '../../hooks/use-google-calendar'
import { Button, Card, cx, StatusPill } from '../ui'
import './google-calendar.css'

export function GoogleCalendarPanel({ calendar }: { calendar: GoogleCalendarController }) {
  const snapshot = calendar.snapshot
  const configured = snapshot?.configured ?? false
  const connections = snapshot?.connections || []
  const idle = !configured || calendar.loading || Boolean(calendar.busy)
  const available = snapshot?.availableAccess ?? []
  const [access, setAccess] = useState<GoogleAccess[]>([])
  const chosen = access.filter((item) => available.includes(item))
  return <Card className="settings-section calendar-settings"><div className="settings-section-head"><div><h2>Google Calendar</h2><p>Connect work and personal accounts independently.</p></div><StatusPill tone={statusTone(calendar)}>{statusLabel(calendar)}</StatusPill></div><CalendarDisclosure />{available.length ? <AccessChoices available={available} chosen={chosen} disabled={idle} onChange={setAccess} /> : null}{connections.length ? <div className="calendar-account-list">{connections.map((connection) => <CalendarAccount key={connection.id} connection={connection} calendar={calendar} available={available} />)}</div> : <div className="status-note">{configured ? 'No Google accounts connected.' : 'Calendar access is not configured for this build.'}</div>}{calendar.error ? <div className="status-note danger" role="alert">{calendar.error}</div> : null}<p>Disconnect removes this account's Calendar cache; recorded Meetings stay on this Mac.</p><div className="actions-row"><Button variant="primary" disabled={idle} onClick={() => void calendar.connect(chosen)}>{calendar.busy === 'connect' ? 'Connecting…' : connections.length ? 'Connect another account' : 'Connect Google Calendar'}</Button></div></Card>
}

const ACCESS_TEXT: Record<GoogleAccess, { title: string; detail: string; on: string }> = {
  gmail: { title: 'Gmail read access', on: 'Gmail', detail: 'Shows your recent email threads with each saved Person. Gappd reads them from Google only when you open them, does not store them, and cannot send, delete, or change mail.' },
  contacts: { title: 'Google Contacts read access', on: 'Contacts', detail: 'Lets People import your saved Google contacts that have an email. Imported names and emails stay on this Mac.' },
}

function AccessChoices(props: { available: GoogleAccess[]; chosen: GoogleAccess[]; disabled: boolean; onChange: (access: GoogleAccess[]) => void }) {
  const toggle = (item: GoogleAccess, on: boolean) => props.onChange(on ? [...props.chosen, item] : props.chosen.filter((value) => value !== item))
  return <div className="calendar-access">{props.available.map((item) => <label key={item} className="startup-setting"><span className="startup-setting-copy"><strong>{ACCESS_TEXT[item].title} (optional)</strong><span>{ACCESS_TEXT[item].detail}</span></span><input type="checkbox" checked={props.chosen.includes(item)} disabled={props.disabled} onChange={(event) => toggle(item, event.target.checked)} /></label>)}</div>
}

function CalendarDisclosure() {
  return <div className="calendar-disclosure"><strong>Before you connect</strong><span>Gappd opens Google in your browser and requests read-only access to events you own on your primary calendar. It shows upcoming events and suggests event invitees for Meetings. Availability-only access cannot provide these details. Gappd exchanges tokens directly with Google. Tokens and cached events are encrypted on this Mac; no Gappd server receives them.</span></div>
}

function CalendarAccount({ connection, calendar, available }: { connection: CalendarConnection; calendar: GoogleCalendarController; available: GoogleAccess[] }) {
  const busy = Boolean(calendar.busy)
  const missing = available.filter((item) => !connection.access?.includes(item))
  const disconnect = () => {
    if (!window.confirm(`Disconnect ${connection.email}?\n\nCalendar events for this account will be removed from Gappd. Recorded meetings stay on this Mac.`)) return
    void calendar.disconnect(connection.id)
  }
  return <div className={cx('calendar-account', connection.status === 'error' && 'has-error')}><div><strong>{connection.email}</strong><span>{connectionNote(connection)}</span></div><div className="calendar-account-actions">{missing.length ? <Button disabled={busy} title="Sign in to this account again in Google" onClick={() => void calendar.connect(missing)}>Add {missing.map((item) => ACCESS_TEXT[item].on).join(' and ')}</Button> : null}<Button disabled={busy} onClick={() => void calendar.sync(connection.id)}>{calendar.busy === `sync:${connection.id}` ? 'Refreshing…' : 'Refresh'}</Button><Button disabled={busy} onClick={disconnect}>{calendar.busy === `disconnect:${connection.id}` ? 'Disconnecting…' : 'Disconnect'}</Button></div></div>
}

function connectionNote(connection: CalendarConnection): string {
  if (connection.error) return connection.error
  const access = connection.access?.length ? ` · ${connection.access.map((item) => ACCESS_TEXT[item].on).join(' and ')} on` : ''
  return refreshNote(connection) + access
}

function refreshNote(connection: CalendarConnection): string {
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
