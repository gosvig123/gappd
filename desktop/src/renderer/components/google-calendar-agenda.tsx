import { agendaDraftKey } from '../../shared/agenda-draft'
import { calendarEventIsUpcoming } from '../../shared/meeting-agenda'
import { MeetingAgendaDraftPanel } from './meeting-agenda-draft'
import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'
import { RefreshIcon } from './icons'
import { Button } from './ui'
import './google-calendar.css'

export function GoogleCalendarAgenda({ calendar, onOpenSettings, onRecord, canRecord, onOpenMeeting, knownMeetingIds }: { onOpenMeeting: (id: string) => void; onRecord: (sourceId: string) => void; canRecord: boolean; calendar: GoogleCalendarController; onOpenSettings: () => void; knownMeetingIds?: ReadonlySet<string> }) {
  if (calendar.loading || !calendar.snapshot?.configured) return null
  const connections = calendar.snapshot.connections
  const events = calendar.snapshot.events.filter((event) => calendarEventIsUpcoming(event))
  if (!connections.length) return <section className="calendar-agenda calendar-agenda-empty"><div><strong>Upcoming calendar</strong><span>Connect Google Calendar to see upcoming events beside your meetings.</span></div><Button onClick={onOpenSettings}>Open Settings</Button></section>
  return <section className="calendar-agenda" aria-label="Upcoming Google Calendar events"><div className="calendar-agenda-head"><div><strong>Upcoming calendar</strong><span>{eventCountLabel(events.length, connections.length)}</span></div><Button className="compact-action" disabled={Boolean(calendar.busy)} onClick={() => void calendar.syncAll()}><RefreshIcon aria-hidden="true" />{calendar.busy === 'sync-all' ? 'Refreshing…' : 'Refresh'}</Button></div>{calendar.error ? <div className="calendar-agenda-error" role="alert">{calendar.error}</div> : null}{events.length ? <div className="calendar-event-list">{events.map((event) => <div key={event.sourceId}><CalendarEvent event={event} onRecord={onRecord} canRecord={canRecord} />{calendarEventIsUpcoming(event) ? <MeetingAgendaDraftPanel draftKey={agendaDraftKey(event)} sourceId={event.sourceId} canGenerate knownMeetingIds={knownMeetingIds} onOpenMeeting={onOpenMeeting} onOpenSettings={onOpenSettings} /> : null}</div>)}</div> : <div className="calendar-agenda-none">No upcoming Calendar events.</div>}</section>
}

function CalendarEvent({ event, onRecord, canRecord }: { event: CalendarEventSummary; onRecord: (sourceId: string) => void; canRecord: boolean }) {
  return <div className="calendar-event"><div className="calendar-event-time">{eventTime(event)}</div><div className="calendar-event-copy"><strong>{event.title}</strong><span>{[event.accountEmail, event.location].filter(Boolean).join(' · ')}</span></div><Button className="compact-action" disabled={!canRecord} onClick={() => onRecord(event.sourceId)}>Record</Button></div>
}

function eventTime(event: CalendarEventSummary): string {
  if (event.allDay) return `${event.start} · All day`
  const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(event.start))} · ${format.format(new Date(event.start))}–${format.format(new Date(event.end))}`
}

function eventCountLabel(events: number, connections: number): string {
  const accountLabel = `${connections} ${connections === 1 ? 'account' : 'accounts'}`
  return `${events} ${events === 1 ? 'event' : 'events'} · ${accountLabel}`
}
