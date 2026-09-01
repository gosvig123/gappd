import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'
import { RefreshIcon } from './icons'
import { Button } from './ui'
import './google-calendar.css'

export function GoogleCalendarAgenda({ calendar, onOpenSettings }: { calendar: GoogleCalendarController; onOpenSettings: () => void }) {
  if (calendar.loading || !calendar.snapshot?.configured) return null
  const connections = calendar.snapshot.connections
  const events = calendar.snapshot.events.filter((event) => eventIsToday(event))
  if (!connections.length) return <section className="calendar-agenda calendar-agenda-empty"><div><strong>Today’s calendar</strong><span>Connect Google Calendar to see today’s events beside your meetings.</span></div><Button onClick={onOpenSettings}>Open Settings</Button></section>
  return <section className="calendar-agenda" aria-label="Today’s Google Calendar events"><div className="calendar-agenda-head"><div><strong>Today’s calendar</strong><span>{eventCountLabel(events.length, connections.length)}</span></div><Button className="compact-action" disabled={Boolean(calendar.busy)} onClick={() => void calendar.syncAll()}><RefreshIcon aria-hidden="true" />{calendar.busy === 'sync-all' ? 'Refreshing…' : 'Refresh'}</Button></div>{calendar.error ? <div className="calendar-agenda-error" role="alert">{calendar.error}</div> : null}{events.length ? <div className="calendar-event-list">{events.map((event) => <CalendarEvent key={event.sourceId} event={event} />)}</div> : <div className="calendar-agenda-none">No Calendar events today.</div>}</section>
}

function CalendarEvent({ event }: { event: CalendarEventSummary }) {
  return <div className="calendar-event"><div className="calendar-event-time">{eventTime(event)}</div><div className="calendar-event-copy"><strong>{event.title}</strong><span>{[event.accountEmail, event.location].filter(Boolean).join(' · ')}</span></div></div>
}

function eventIsToday(event: CalendarEventSummary, now = new Date()): boolean {
  if (event.allDay) {
    const today = localDateKey(now)
    return event.start <= today && event.end > today
  }
  const start = new Date(event.start).getTime()
  const end = new Date(event.end).getTime()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Number.isFinite(start) && Number.isFinite(end) && start < dayStart + 24 * 60 * 60 * 1000 && end > dayStart
}

function eventTime(event: CalendarEventSummary): string {
  if (event.allDay) return 'All day'
  const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${format.format(new Date(event.start))}–${format.format(new Date(event.end))}`
}

function localDateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

function eventCountLabel(events: number, connections: number): string {
  const accountLabel = `${connections} ${connections === 1 ? 'account' : 'accounts'}`
  return `${events} ${events === 1 ? 'event' : 'events'} · ${accountLabel}`
}
