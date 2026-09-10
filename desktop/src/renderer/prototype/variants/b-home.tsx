import { useState } from 'react'
import { CalendarClock, RefreshCw } from 'lucide-react'
import type { CalendarConnection, CalendarEventSummary } from '../../../shared/calendar-contract'
import type { SavedAgendaDraft } from '../../../shared/agenda-draft'
import { Button } from '../../components/ui'
import { artifactLine, eventIsNow, eventTimeRange, upcomingEvents, type PrototypeView } from '../contract'
import { meetingTimeLabel } from '../grouping'
import { InlineConfirm } from './b-inline-confirm'

const RECENT_LIMIT = 4

/** Idle pane: what is coming, what is connected, what is prepared, and what just happened. */
export function HomePane({ view, onOpenSettings }: { view: PrototypeView; onOpenSettings: () => void }) {
  const events = upcomingEvents(view.calendar, 4)
  const connections = view.calendar?.connections ?? []
  const recent = view.meetings.slice(0, RECENT_LIMIT)
  return (
    <div className="vb-home">
      <header className="vb-home-head">
        <p className="proto-eyebrow">No Meeting open</p>
        <h1 className="vb-pane-title">Today at a glance</h1>
        <p className="vb-home-sub">{summaryLine(view, events.length, connections.length)}</p>
      </header>
      <UpNextCard view={view} events={events} />
      <ConnectionsSection view={view} connections={connections} onOpenSettings={onOpenSettings} />
      <DraftsSection drafts={view.drafts} />
      <section className="vb-card" aria-label="Recent meetings">
        <div className="vb-card-head"><span className="proto-eyebrow">Recent Meetings</span></div>
        <ul className="vb-recent">
          {recent.map((meeting) => (
            <li key={meeting.id}>
              <button type="button" className="vb-recent-row" onClick={() => view.actions.openMeeting(meeting.id)}>
                <span className="vb-recent-title">{meeting.title || 'Untitled meeting'}</span>
                <span className="vb-recent-meta">{meetingTimeLabel(meeting)} · {artifactLine(meeting)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function UpNextCard({ view, events }: { view: PrototypeView; events: CalendarEventSummary[] }) {
  return (
    <section className="vb-card" aria-label="Up next">
      <div className="vb-card-head">
        <span className="proto-eyebrow"><CalendarClock aria-hidden="true" /> Up next</span>
        <button type="button" className="vb-card-action" disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.syncAllCalendars()}><RefreshCw aria-hidden="true" />{view.calendarBusy === 'sync-all' ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {events.length ? events.map((event) => (
        <div key={event.sourceId} className={eventIsNow(event) ? 'vb-event is-now' : 'vb-event'}>
          <span className="vb-event-time">{eventIsNow(event) ? 'Now' : eventTimeRange(event)}</span>
          <span className="vb-event-copy"><strong>{event.title}</strong><span>{[event.accountEmail, event.location].filter(Boolean).join(' · ')}</span></span>
          <Button className="compact-action" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record</Button>
        </div>
      )) : <p className="vb-none">Nothing on the calendar. Connect a Google Calendar connection in Settings to see what is next.</p>}
    </section>
  )
}

function ConnectionsSection({ view, connections, onOpenSettings }: { view: PrototypeView; connections: CalendarConnection[]; onOpenSettings: () => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  return (
    <section className="vb-card" aria-label="Google Calendar connections">
      <div className="vb-card-head"><span className="proto-eyebrow">Google Calendar connections</span><button type="button" className="vb-card-action" onClick={onOpenSettings}>Manage</button></div>
      {connections.length ? connections.map((connection) => (
        confirmId === connection.id
          ? <InlineConfirm key={connection.id} question={`Disconnect ${connection.email}?`} detail="Calendar events for this account leave Gappd. Recorded meetings stay on this Mac." confirmLabel="Disconnect" onConfirm={() => { setConfirmId(null); void view.actions.disconnectCalendar(connection.id) }} onCancel={() => setConfirmId(null)} />
          : (
            <div key={connection.id} className={connection.status === 'error' ? 'vb-connection has-error' : 'vb-connection'}>
              <span className="vb-connection-copy"><strong>{connection.email}</strong><span>{connectionNote(connection)}</span></span>
              <span className="vb-connection-actions">
                <Button className="compact-action" disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.syncCalendar(connection.id)}>{view.calendarBusy === `sync:${connection.id}` ? 'Refreshing…' : 'Refresh'}</Button>
                <Button className="compact-action" disabled={Boolean(view.calendarBusy)} onClick={() => setConfirmId(connection.id)}>Disconnect</Button>
              </span>
            </div>
          )
      )) : <p className="vb-none">No Google accounts connected. Add one in Settings to prompt recording from the calendar.</p>}
    </section>
  )
}

function DraftsSection({ drafts }: { drafts: SavedAgendaDraft[] }) {
  if (!drafts.length) return null
  return (
    <section className="vb-card" aria-label="Saved Agenda drafts">
      <div className="vb-card-head"><span className="proto-eyebrow">Saved Agenda drafts</span></div>
      {drafts.map((draft) => (
        <div key={draft.draftKey} className="vb-event">
          <span className="vb-event-time">{new Date(draft.eventStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span className="vb-event-copy"><strong>{draft.title}</strong><span>{draft.items.length} saved {draft.items.length === 1 ? 'topic' : 'topics'} · updated {new Date(draft.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></span>
          <span className="vb-draft-model">{draft.model || 'model unknown'}</span>
        </div>
      ))}
    </section>
  )
}

function summaryLine(view: PrototypeView, eventCount: number, accountCount: number): string {
  const ready = view.meetings.filter((meeting) => meeting.hasSummary && meeting.hasTranscript).length
  if (!accountCount) return `${view.meetings.length} recorded · ${ready} with notes · no calendar connected`
  return `${view.meetings.length} recorded · ${ready} with notes · ${eventCount} upcoming across ${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}`
}

function connectionNote(connection: CalendarConnection): string {
  if (connection.error) return connection.error
  if (!connection.lastSyncedAt) return connection.status === 'syncing' ? 'Refreshing…' : 'Waiting for first refresh'
  const updated = new Date(connection.lastSyncedAt)
  return Number.isNaN(updated.getTime()) ? 'Previously refreshed' : `Refreshed ${updated.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}
