import { CalendarDays, Clock } from 'lucide-react'
import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../shared/meeting-recording-workflow'
import { meetingHasWork, meetingProgressLabel } from '../components/meeting-progress'
import { Button, ProgressBar, StatusPill, cx } from '../components/ui'
import { artifactLine, eventIsNow, eventTimeRange, upcomingEvents, type AppView } from '../lib/app-view'
import { meetingDurationLabel, meetingTimeLabel } from '../lib/meeting-grouping'
import { EventAgendaChip, MeetingAgendaChip } from '../components/agenda-tab'
import { useOpenMeeting } from '../components/meeting-open-scope'

type TodayProps = { view: AppView; onOpenMeetings: () => void; onOpenCalendar: () => void }

export function TodayView({ view, onOpenMeetings, onOpenCalendar }: TodayProps) {
  const events = todayTimeline(view.calendar)
  const work = view.meetings.filter(meetingHasWork)
  const connections = view.calendar?.connections.length ?? 0
  return (
    <div className="app-stack">
      <header className="app-section-head">
        <p className="ui-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="ui-title">Today</h1>
        <p className="app-section-sub">{events.length} {events.length === 1 ? 'event' : 'events'} on your calendar · {view.meetings.length} Meetings recorded · {connections} calendar {connections === 1 ? 'account' : 'accounts'}</p>
      </header>
      {work.length ? <ul className="app-live">{work.map((meeting) => <LiveCard key={meeting.id} meeting={meeting} view={view} />)}</ul> : null}
      <section className="app-block" aria-label="Today's calendar">
        <BlockHead title="Today's calendar" action={{ label: 'Manage calendars', onClick: onOpenCalendar }} />
        {events.length ? <Timeline events={events} view={view} /> : <UpNext view={view} />}
      </section>
      <section className="app-block" aria-label="Recent meetings">
        <BlockHead title="Recent meetings" action={{ label: 'All meetings', onClick: onOpenMeetings }} />
        <ul className="app-recent">{view.meetings.slice(0, 4).map((meeting) => <RecentRow key={meeting.id} meeting={meeting} view={view} />)}</ul>
      </section>
    </div>
  )
}

function BlockHead({ title, action }: { title: string; action: { label: string; onClick: () => void } }) {
  return (
    <div className="app-block-head">
      <h2>{title}</h2>
      <button type="button" className="app-link" onClick={action.onClick}>{action.label}</button>
    </div>
  )
}

function Timeline({ events, view }: { events: CalendarEventSummary[]; view: AppView }) {
  const nextId = nextEventId(events)
  return <ol className="app-timeline">{events.map((event) => <TimelineRow key={event.sourceId} event={event} next={event.sourceId === nextId} view={view} />)}</ol>
}

function TimelineRow({ event, next, view }: { event: CalendarEventSummary; next: boolean; view: AppView }) {
  const now = eventIsNow(event)
  return (
    <li className={cx('app-timeline-row', now && 'is-now', next && 'is-next')}>
      <span className="app-timeline-pin" aria-hidden="true" />
      <div className="app-timeline-when">
        <strong>{now ? 'Happening now' : clockOf(event)}</strong>
        <span>{eventTimeRange(event)}</span>
      </div>
      <div className="app-timeline-copy">
        <strong>{event.title}</strong>
        <div className="app-timeline-sub">
          <span>{[event.accountEmail, event.location].filter(Boolean).join(' · ')}</span>
          <EventAgendaChip view={view} event={event} />
        </div>
      </div>
      {now || next ? <span className="app-chip">{now ? 'Now' : 'Next'}</span> : null}
      <Button className="compact-action" disabled={!view.canStart} title={view.canStart ? undefined : 'Connect an audio input to record'} onClick={() => view.actions.start(event.sourceId)}>Record</Button>
    </li>
  )
}

function UpNext({ view }: { view: AppView }) {
  const events = upcomingEvents(view.calendar, 4)
  if (!events.length) {
    return (
      <div className="app-empty">
        <CalendarDays aria-hidden="true" />
        <strong>No calendar events today</strong>
        <span>Connect a Google Calendar connection to see the day here and ground Agenda drafts in past Meetings.</span>
      </div>
    )
  }
  return (
    <div className="app-upcoming">
      <p className="app-upcoming-note"><Clock aria-hidden="true" /> Nothing left today. Next up:</p>
      <ul>
        {events.map((event) => (
          <li key={event.sourceId}>
            <div><strong>{event.title}</strong><span>{eventTimeRange(event)}</span></div>
            <Button className="compact-action" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LiveCard({ meeting, view }: { meeting: MeetingListItem; view: AppView }) {
  const recording = meeting.status.state === 'recording'
  return (
    <li className="app-live-card">
      <div className="app-live-head">
        {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{meetingProgressLabel(meeting)}</StatusPill> : null}
        <button type="button" className="app-link app-live-title" onClick={() => view.actions.openMeeting(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
        <span className="app-live-elapsed">{recording ? 'Capturing microphone and system audio' : 'Processing locally'}</span>
      </div>
      <ProgressBar value={null} label={meetingProgressLabel(meeting)} />
      <p className="app-live-note">{artifactLine(meeting)}</p>
    </li>
  )
}

function RecentRow({ meeting, view }: { meeting: MeetingListItem; view: AppView }) {
  const open = useOpenMeeting(view.actions.openMeeting)
  return (
    <li className="app-recent-row">
      <span className="app-recent-time">{meetingTimeLabel(meeting)}</span>
      <button type="button" className="app-recent-title" onClick={() => open(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
      <span className="app-recent-meta">
        <span>{meetingDurationLabel(meeting)} · {artifactLine(meeting)}</span>
        <MeetingAgendaChip view={view} meetingId={meeting.id} onOpen={() => open(meeting.id, 'agenda')} />
      </span>
    </li>
  )
}

function todayTimeline(calendar: CalendarSnapshot | null, now = new Date()): CalendarEventSummary[] {
  if (!calendar) return []
  return calendar.events
    .filter((event) => new Date(event.start).toDateString() === now.toDateString() || eventIsNow(event, now))
    .sort((left, right) => left.start.localeCompare(right.start))
}

function nextEventId(events: CalendarEventSummary[], now = new Date()): string | undefined {
  return events.find((event) => new Date(event.start).getTime() > now.getTime())?.sourceId
}

function clockOf(event: CalendarEventSummary): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(event.start))
}
