import { CalendarDays, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import { Button, EmptyState, StatusPill } from '../../components/ui'
import { meetingHasWork } from '../../components/meeting-progress'
import { artifactLine, eventIsNow, eventTimeRange, statusLabel, upcomingEvents, type PrototypeView } from '../contract'
import { excerpt, groupByDate, meetingDurationLabel, meetingTimeLabel, searchMeetings, type SearchHit } from '../grouping'
import type { ConfirmController } from '../proto-dialog'

type IndexProps = { view: PrototypeView; query: string; onQueryChange: (value: string) => void; onOpenSettings: () => void; confirm: ConfirmController }

export function ReadingIndex({ view, query, onOpenSettings, confirm }: IndexProps) {
  const hits = searchMeetings(view.meetings, view.meetingDetails, query)
  const upcoming = upcomingEvents(view.calendar, 3)
  return (
    <div className="va-column">
      <IndexHeader view={view} query={query} onOpenSettings={onOpenSettings} upcomingCount={upcoming.length} />
      <UpNext view={view} onOpenSettings={onOpenSettings} />
      {query.trim() ? <SearchResults hits={hits} term={query} view={view} /> : <GroupedMeetings view={view} confirm={confirm} />}
    </div>
  )
}

function IndexHeader({ view, query, onOpenSettings, upcomingCount }: { view: PrototypeView; query: string; onOpenSettings: () => void; upcomingCount: number }) {
  const ready = view.meetings.filter((meeting) => meeting.hasSummary && meeting.hasTranscript).length
  return (
    <div className="va-index-head">
      <div>
        <p className="proto-eyebrow">Local meeting history</p>
        <h1 className="proto-hero">{query.trim() ? `Results for “${query.trim()}”` : 'Meetings'}</h1>
        <p className="va-index-sub">{view.meetings.length} recorded · {ready} with notes · {upcomingCount} upcoming on your calendar</p>
      </div>
      <Button className="compact-action" onClick={onOpenSettings}>Calendar and AI settings</Button>
    </div>
  )
}

function UpNext({ view, onOpenSettings }: { view: PrototypeView; onOpenSettings: () => void }) {
  const events = upcomingEvents(view.calendar, 3)
  const connections = view.calendar?.connections ?? []
  if (!connections.length) {
    return (
      <section className="va-upnext is-empty">
        <div><strong>No calendar connected</strong><span>Connect a Google Calendar connection to prompt recording and ground Agenda drafts.</span></div>
        <Button className="compact-action" onClick={onOpenSettings}>Connect</Button>
      </section>
    )
  }
  return (
    <section className="va-upnext" aria-label="Up next">
      <div className="va-upnext-head">
        <span className="proto-eyebrow"><CalendarDays aria-hidden="true" /> Up next · {connections.length} {connections.length === 1 ? 'account' : 'accounts'} · {view.drafts.length} saved agenda {view.drafts.length === 1 ? 'draft' : 'drafts'}</span>
        <button type="button" className="va-upnext-sync" disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.syncAllCalendars()}><RefreshCw aria-hidden="true" />{view.calendarBusy === 'sync-all' ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {events.map((event) => (
        <div key={event.sourceId} className={eventIsNow(event) ? 'va-event is-now' : 'va-event'}>
          <div className="va-event-time">{eventIsNow(event) ? 'Now' : eventTimeRange(event)}</div>
          <div className="va-event-copy"><strong>{event.title}</strong><span>{[event.accountEmail, event.location].filter(Boolean).join(' · ')}</span></div>
          <Button className="compact-action" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record</Button>
        </div>
      ))}
    </section>
  )
}

function SearchResults({ hits, term, view }: { hits: SearchHit[]; term: string; view: PrototypeView }) {
  if (!hits.length) return <EmptyState>No Meeting matches “{term.trim()}”. Search covers titles, People, notes, and transcript text.</EmptyState>
  return (
    <ul className="va-hits">
      {hits.map((hit) => (
        <li key={hit.meeting.id}>
          <button type="button" className="va-hit" onClick={() => view.actions.openMeeting(hit.meeting.id)}>
            <span className="va-hit-title">{hit.meeting.title || 'Untitled meeting'}</span>
            <span className="va-hit-meta">{meetingTimeLabel(hit.meeting)} · {hit.reason.split(' · ')[0]}</span>
            <span className="va-hit-reason">{excerpt(hit.reason, term, 72)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function GroupedMeetings({ view, confirm }: { view: PrototypeView; confirm: ConfirmController }) {
  if (!view.meetings.length) return <EmptyState>No meetings yet. Press Record to capture the next one.</EmptyState>
  return (
    <div className="va-groups">
      {groupByDate(view.meetings).map((group) => (
        <section key={group.key} className="va-group" aria-label={group.title}>
          <h2 className="va-group-head">{group.title}<span>{group.meetings.length}</span></h2>
          <ul>
            {group.meetings.map((meeting) => (
              <li key={meeting.id} className="va-row-wrap">
                <button type="button" className="va-row" onClick={() => view.actions.openMeeting(meeting.id)}>
                  <span className="va-row-time">{meetingTimeLabel(meeting)}</span>
                  <span className="va-row-body">
                    <span className="va-row-title">{meeting.title || 'Untitled meeting'}</span>
                    <span className="va-row-line">{artifactLine(meeting)} · {meetingDurationLabel(meeting)}</span>
                  </span>
                  {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{statusLabel(meeting)}</StatusPill> : null}
                </button>
                {meetingHasWork(meeting) ? null : (
                  <button
                    type="button"
                    className="va-row-delete"
                    aria-label={`Delete ${meeting.title || 'meeting'}`}
                    onClick={() => confirm.request({
                      title: 'Delete this Meeting?',
                      body: <>Removes the summary, transcript, speaker labels, and audio for “{meeting.title || 'Untitled meeting'}”. This cannot be undone.</>,
                      confirmLabel: 'Delete Meeting',
                      tone: 'danger',
                      onConfirm: () => view.actions.deleteMeeting(meeting.id),
                    })}
                  ><Trash2 aria-hidden="true" /></button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="va-footnote"><ExternalLink aria-hidden="true" /> Everything stays on this Mac. Nothing here is uploaded.</p>
    </div>
  )
}
