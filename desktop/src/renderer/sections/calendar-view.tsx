import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { agendaDraftCanGenerate, agendaDraftEvent, agendaDraftKey, savedAgendaDraftsOutsideUpcoming, type SavedAgendaDraft } from '../../shared/agenda-draft'
import type { CalendarConnection, CalendarEventSummary } from '../../shared/calendar-contract'
import { MeetingAgendaDraftPanel } from '../components/meeting-agenda-draft'
import { Button, EmptyState, StatusPill, cx } from '../components/ui'
import { eventIsNow, eventTimeRange, upcomingEvents, type AppView } from '../lib/app-view'
import type { ConfirmController } from '../components/confirm'
import { EventAgendaChip } from '../components/agenda-tab'
import '../components/google-calendar.css'

type CalendarViewProps = { view: AppView; confirm: ConfirmController; onOpenSettings: () => void }

function inviteeLabel(event: CalendarEventSummary): string | null {
  const count = event.attendees?.length ?? 0
  if (!count) return null
  return `${count} ${count === 1 ? 'invitee' : 'invitees'}`
}

export function CalendarView({ view, confirm, onOpenSettings }: CalendarViewProps) {
  const connections = view.calendar?.connections ?? []
  const knownMeetingIds = new Set(view.meetings.map((meeting) => meeting.id))
  return (
    <div className="app-stack">
      <CalendarHead view={view} />
      <AccountsBlock connections={connections} view={view} confirm={confirm} onOpenSettings={onOpenSettings} />
      <UpcomingBlock view={view} knownMeetingIds={knownMeetingIds} onOpenSettings={onOpenSettings} />
      <DraftsBlock view={view} knownMeetingIds={knownMeetingIds} onOpenSettings={onOpenSettings} />
    </div>
  )
}

function CalendarHead({ view }: { view: AppView }) {
  const connections = view.calendar?.connections.length ?? 0
  const events = upcomingEvents(view.calendar, 5).length
  return (
    <header className="app-section-head">
      <p className="ui-eyebrow">Read-only calendar access</p>
      <h1 className="ui-title">Calendar</h1>
      <p className="app-section-sub">{connections} connected {connections === 1 ? 'account' : 'accounts'} · {events} upcoming {events === 1 ? 'event' : 'events'} · {view.drafts.length} saved agenda {view.drafts.length === 1 ? 'draft' : 'drafts'}</p>
    </header>
  )
}

function AccountsBlock({ connections, view, confirm, onOpenSettings }: { connections: CalendarConnection[]; view: AppView; confirm: ConfirmController; onOpenSettings: () => void }) {
  return (
    <section className="app-block" aria-label="Connected accounts">
      <div className="app-block-head">
        <h2>Accounts</h2>
        <button type="button" className="app-link" disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.syncAllCalendars()}>{view.calendarBusy === 'sync-all' ? 'Refreshing…' : 'Refresh all'}</button>
      </div>
      {connections.length
        ? <ul className="app-accounts">{connections.map((connection) => <AccountRow key={connection.id} connection={connection} view={view} confirm={confirm} />)}</ul>
        : <EmptyState>No Google accounts connected. Add one in Settings to see upcoming events and prepare Agenda drafts.</EmptyState>}
      {view.calendarError ? <p className="app-error" role="alert">{view.calendarError}</p> : null}
      <div className="app-block-foot">
        <Button className="compact-action" onClick={onOpenSettings}>Calendar settings</Button>
        <Button className="compact-action" disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.connectCalendar()}>Connect another account</Button>
      </div>
    </section>
  )
}

/** Upcoming events are where an Agenda is prepared, so each one can open its editor here. */
function UpcomingBlock({ view, knownMeetingIds, onOpenSettings }: { view: AppView; knownMeetingIds: ReadonlySet<string>; onOpenSettings: () => void }) {
  const [openSourceId, setOpenSourceId] = useState<string | null>(null)
  const events = upcomingEvents(view.calendar, 5)
  return (
    <section className="app-block" aria-label="Upcoming events">
      <div className="app-block-head"><h2>Upcoming</h2><span className="app-block-note">Recording from an event links its Calendar invitees to the Meeting</span></div>
      {events.length ? (
        <ul className="app-events">
          {events.map((event) => (
            <UpcomingRow key={event.sourceId} event={event} view={view} open={openSourceId === event.sourceId} knownMeetingIds={knownMeetingIds} onOpenSettings={onOpenSettings} onToggle={() => setOpenSourceId((current) => (current === event.sourceId ? null : event.sourceId))} />
          ))}
        </ul>
      ) : <p className="app-block-note">No upcoming Calendar events.</p>}
    </section>
  )
}

function UpcomingRow({ event, view, open, knownMeetingIds, onOpenSettings, onToggle }: { event: CalendarEventSummary; view: AppView; open: boolean; knownMeetingIds: ReadonlySet<string>; onOpenSettings: () => void; onToggle: () => void }) {
  return (
    <li className={cx('app-event', eventIsNow(event) && 'is-now')}>
      <div className="app-event-when">{eventIsNow(event) ? 'Now' : eventTimeRange(event)}</div>
      <div className="app-event-copy"><strong>{event.title}</strong><span>{[event.accountEmail, event.location, inviteeLabel(event)].filter(Boolean).join(' · ')}</span></div>
      <div className="app-event-actions">
        <EventAgendaChip view={view} event={event} />
        <Button className="compact-action" aria-expanded={open} onClick={onToggle}>{open ? 'Hide agenda' : 'Agenda'}</Button>
        <Button className="compact-action" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record</Button>
      </div>
      {open ? (
        <div className="app-draft-editor app-event-editor">
          <MeetingAgendaDraftPanel draftKey={agendaDraftKey(event)} sourceId={event.sourceId} canGenerate knownMeetingIds={knownMeetingIds} onOpenMeeting={view.actions.openMeeting} onOpenSettings={onOpenSettings} />
        </div>
      ) : null}
    </li>
  )
}

function DraftsBlock({ view, knownMeetingIds, onOpenSettings }: { view: AppView; knownMeetingIds: ReadonlySet<string>; onOpenSettings: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  // Upcoming events keep their single editor in the Upcoming block, so this list
  // must not offer a second one for the same event.
  const listed = savedAgendaDraftsOutsideUpcoming(view.drafts, view.calendar?.events ?? [])
  return (
    <section className="app-block" aria-label="Saved agenda drafts">
      <div className="app-block-head"><h2>Saved agenda drafts</h2><span className="app-block-note">Stored encrypted on this Mac</span></div>
      {listed.length ? (
        <ul className="app-drafts">
          {listed.map((draft) => <DraftRow key={draft.draftKey} draft={draft} open={openKey === draft.draftKey} onToggle={() => setOpenKey((current) => (current === draft.draftKey ? null : draft.draftKey))} view={view} />)}
        </ul>
      ) : <p className="app-block-note">No saved Agenda drafts yet. Generate one on an upcoming event to keep the topics here.</p>}
      {openKey ? <DraftEditor draftKey={openKey} view={view} knownMeetingIds={knownMeetingIds} onOpenSettings={onOpenSettings} /> : null}
    </section>
  )
}

function AccountRow({ connection, view, confirm }: { connection: CalendarConnection; view: AppView; confirm: ConfirmController }) {
  return (
    <li className={cx('app-account', connection.status === 'error' && 'has-error')}>
      <div className="app-account-copy">
        <strong>{connection.email}</strong>
        <span>{connection.error ?? lastRefreshLabel(connection)}</span>
      </div>
      <StatusPill tone={connectionTone(connection)}>{connection.status === 'ready' ? 'Connected' : connection.status === 'syncing' ? 'Refreshing' : 'Needs attention'}</StatusPill>
      <Button className="compact-action" disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.syncCalendar(connection.id)}>{view.calendarBusy === `sync:${connection.id}` ? 'Refreshing…' : 'Refresh'}</Button>
      <button
        type="button"
        className="app-icon-action"
        aria-label={`Disconnect ${connection.email}`}
        onClick={() => confirm.request({ title: 'Disconnect this account?', body: `Calendar events from ${connection.email} are removed from Gappd. Recorded Meetings stay on this Mac.`, confirmLabel: 'Disconnect', tone: 'danger', onConfirm: () => view.actions.disconnectCalendar(connection.id) })}
      ><Trash2 aria-hidden="true" /></button>
    </li>
  )
}

function DraftRow({ draft, open, onToggle, view }: { draft: SavedAgendaDraft; open: boolean; onToggle: () => void; view: AppView }) {
  const events = view.calendar?.events ?? []
  const event = agendaDraftEvent(draft, events)
  const canGenerate = agendaDraftCanGenerate(draft, events)
  const topicCount = draft.items.length
  return (
    <li className="app-draft">
      <div className="app-draft-when">{new Date(draft.eventStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
      <div className="app-draft-copy">
        <strong>{draft.title}</strong>
        <span>{topicCount} {topicCount === 1 ? 'topic' : 'topics'} · updated {new Date(draft.updatedAt).toLocaleString()} · {draft.model || 'model unknown'}</span>
        <span className="app-draft-state">{event ? 'Event is still upcoming. Regenerating replaces your edits.' : 'Event left the upcoming window. Saved topics stay editable.'}</span>
      </div>
      {canGenerate ? null : <span className="app-chip">Read-only · event passed</span>}
      <Button className="compact-action" aria-expanded={open} onClick={onToggle}>{open ? 'Hide' : 'Edit topics'}</Button>
    </li>
  )
}

function DraftEditor({ draftKey, view, knownMeetingIds, onOpenSettings }: { draftKey: string; view: AppView; knownMeetingIds: ReadonlySet<string>; onOpenSettings: () => void }) {
  const draft = view.drafts.find((item) => item.draftKey === draftKey)
  if (!draft) return null
  return (
    <div className="app-draft-editor">
      <MeetingAgendaDraftPanel draftKey={draft.draftKey} sourceId={draft.sourceId} canGenerate knownMeetingIds={knownMeetingIds} onOpenMeeting={view.actions.openMeeting} onOpenSettings={onOpenSettings} />
    </div>
  )
}

function connectionTone(connection: CalendarConnection): string {
  if (connection.status === 'error') return 'danger'
  if (connection.status === 'syncing') return 'processing'
  return 'success'
}

function lastRefreshLabel(connection: CalendarConnection): string {
  if (!connection.lastSyncedAt) return 'Waiting for first refresh'
  const value = new Date(connection.lastSyncedAt)
  return Number.isNaN(value.getTime()) ? 'Previously refreshed' : `Refreshed ${value.toLocaleString()}`
}
