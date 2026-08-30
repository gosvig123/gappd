import { useEffect, useState } from 'react'
import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import { Button, Card, cx, StatusPill } from './ui'

const EVENT_LIMIT = 8
const CONNECT_ACTION = 'connect'

export function GoogleCalendarPanel() {
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => loadSnapshot(setSnapshot, setError), [])
  const run = async (key: string, action: () => Promise<CalendarSnapshot>) => {
    setBusy(key); setError(null)
    try { setSnapshot(await action()) }
    catch (cause) { setError(errorMessage(cause)); await refreshSnapshot(setSnapshot) }
    finally { setBusy(null) }
  }
  const disconnect = (id: string, email: string) => {
    if (!window.confirm(`Disconnect ${email}? Cached calendar events for this account will be removed. Recorded meetings stay in Gappd.`)) return
    void run(id, () => window.gappd.calendar.disconnect(id))
  }
  return <Card className="settings-section"><PanelHeading snapshot={snapshot} /><div className={cx('status-note', error ? 'danger' : undefined)}>{error || calendarNote(snapshot)}</div><div className="actions-row"><Button variant="primary" disabled={Boolean(busy) || snapshot?.configured === false} onClick={() => void run(CONNECT_ACTION, window.gappd.calendar.connectGoogle)}>{busy === CONNECT_ACTION ? 'Waiting for browser…' : 'Connect Google account'}</Button></div><div className="oauth-account-list">{snapshot?.connections.map((connection) => <div className="oauth-account-row" key={connection.id}><span className="oauth-account-copy"><strong>{connection.email}</strong><span>{connectionNote(connection.lastSyncedAt, connection.error)}</span></span><span className="oauth-account-actions"><Button disabled={Boolean(busy)} onClick={() => void run(connection.id, () => window.gappd.calendar.sync(connection.id))}>{busy === connection.id ? 'Syncing…' : 'Sync'}</Button><Button disabled={Boolean(busy)} onClick={() => disconnect(connection.id, connection.email)}>Disconnect</Button></span></div>)}</div><EventList events={snapshot?.events || []} /></Card>
}

function PanelHeading({ snapshot }: { snapshot: CalendarSnapshot | null }) {
  const count = snapshot?.connections.length || 0
  return <div className="settings-section-head"><div><h2>Google Calendar</h2><p>Upcoming events from each connected account’s primary calendar.</p></div><StatusPill tone={count ? 'success' : 'neutral'}>{count ? `${count} connected` : 'Not connected'}</StatusPill></div>
}

function EventList({ events }: { events: CalendarEventSummary[] }) {
  if (!events.length) return null
  return <div className="oauth-event-list" aria-label="Upcoming Google Calendar events">{events.slice(0, EVENT_LIMIT).map((event) => <div className="oauth-event-row" key={event.sourceId}><strong>{event.title}</strong><span className="oauth-event-time">{formatEventTime(event)} · {event.accountEmail}</span></div>)}</div>
}

function formatEventTime(event: CalendarEventSummary): string {
  if (event.allDay) return `${event.start} · All day`
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.start))
}

function connectionNote(lastSyncedAt?: string, error?: string): string {
  if (error) return error
  if (!lastSyncedAt) return 'Not synced yet'
  return `Synced ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSyncedAt))}`
}

function calendarNote(snapshot: CalendarSnapshot | null): string {
  if (!snapshot) return 'Checking calendar connections…'
  if (!snapshot.configured) return 'Google Calendar is not configured for this build.'
  return 'Connect Google Calendar does not create a Gappd account. Calendar data and authorization remain on this Mac.'
}

function loadSnapshot(setSnapshot: (snapshot: CalendarSnapshot) => void, setError: (error: string) => void) {
  let active = true
  window.gappd.calendar.snapshot().then((snapshot) => { if (active) setSnapshot(snapshot) }).catch((cause) => { if (active) setError(errorMessage(cause)) })
  return () => { active = false }
}

async function refreshSnapshot(setSnapshot: (snapshot: CalendarSnapshot) => void): Promise<void> {
  try { setSnapshot(await window.gappd.calendar.snapshot()) }
  catch { /* Preserve the original operation error. */ }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
