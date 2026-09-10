import { CalendarDays, Clock } from 'lucide-react'
import type { CalendarEventSummary, CalendarSnapshot } from '../../../shared/calendar-contract'
import type { MeetingListItem } from '../../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../../shared/meeting-recording-workflow'
import { meetingHasWork, meetingProgressLabel } from '../../components/meeting-progress'
import { Button, ProgressBar, StatusPill, cx } from '../../components/ui'
import { artifactLine, eventIsNow, eventTimeRange, upcomingEvents, type PrototypeView } from '../contract'
import { meetingDurationLabel, meetingTimeLabel } from '../grouping'

type TodayProps = { view: PrototypeView; onOpenMeetings: () => void; onOpenCalendar: () => void }

export function DeckToday({ view, onOpenMeetings, onOpenCalendar }: TodayProps) {
  const events = todayTimeline(view.calendar)
  const work = view.meetings.filter(meetingHasWork)
  const connections = view.calendar?.connections.length ?? 0
  return (
    <div className="vc-stack">
      <header className="vc-section-head">
        <p className="proto-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="proto-title">Today</h1>
        <p className="vc-section-sub">{events.length} {events.length === 1 ? 'event' : 'events'} on your calendar · {view.meetings.length} Meetings recorded · {connections} calendar {connections === 1 ? 'account' : 'accounts'}</p>
      </header>
      {work.length ? <ul className="vc-live">{work.map((meeting) => <LiveCard key={meeting.id} meeting={meeting} view={view} />)}</ul> : null}
      <section className="vc-block" aria-label="Today's calendar">
        <BlockHead title="Today's calendar" action={{ label: 'Manage calendars', onClick: onOpenCalendar }} />
        {events.length ? <Timeline events={events} view={view} /> : <UpNext view={view} />}
      </section>
      <section className="vc-block" aria-label="Recent meetings">
        <BlockHead title="Recent meetings" action={{ label: 'All meetings', onClick: onOpenMeetings }} />
        <ul className="vc-recent">{view.meetings.slice(0, 4).map((meeting) => <RecentRow key={meeting.id} meeting={meeting} view={view} />)}</ul>
      </section>
    </div>
  )
}

function BlockHead({ title, action }: { title: string; action: { label: string; onClick: () => void } }) {
  return (
    <div className="vc-block-head">
      <h2>{title}</h2>
      <button type="button" className="vc-link" onClick={action.onClick}>{action.label}</button>
    </div>
  )
}

function Timeline({ events, view }: { events: CalendarEventSummary[]; view: PrototypeView }) {
  const nextId = nextEventId(events)
  return <ol className="vc-timeline">{events.map((event) => <TimelineRow key={event.sourceId} event={event} next={event.sourceId === nextId} view={view} />)}</ol>
}

function TimelineRow({ event, next, view }: { event: CalendarEventSummary; next: boolean; view: PrototypeView }) {
  const now = eventIsNow(event)
  return (
    <li className={cx('vc-timeline-row', now && 'is-now', next && 'is-next')}>
      <span className="vc-timeline-pin" aria-hidden="true" />
      <div className="vc-timeline-when">
        <strong>{now ? 'Happening now' : clockOf(event)}</strong>
        <span>{eventTimeRange(event)}</span>
      </div>
      <div className="vc-timeline-copy">
        <strong>{event.title}</strong>
        <span>{[event.accountEmail, event.location].filter(Boolean).join(' · ')}</span>
      </div>
      {now || next ? <span className="vc-chip">{now ? 'Now' : 'Next'}</span> : null}
      <Button className="compact-action" disabled={!view.canStart} title={view.canStart ? undefined : 'Connect an audio input to record'} onClick={() => view.actions.start(event.sourceId)}>Record</Button>
    </li>
  )
}

function UpNext({ view }: { view: PrototypeView }) {
  const events = upcomingEvents(view.calendar, 4)
  if (!events.length) {
    return (
      <div className="vc-empty">
        <CalendarDays aria-hidden="true" />
        <strong>No calendar events today</strong>
        <span>Connect a Google Calendar connection to see the day here and ground Agenda drafts in past Meetings.</span>
      </div>
    )
  }
  return (
    <div className="vc-upcoming">
      <p className="vc-upcoming-note"><Clock aria-hidden="true" /> Nothing left today. Next up:</p>
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

function LiveCard({ meeting, view }: { meeting: MeetingListItem; view: PrototypeView }) {
  const recording = meeting.status.state === 'recording'
  return (
    <li className="vc-live-card">
      <div className="vc-live-head">
        {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{meetingProgressLabel(meeting)}</StatusPill> : null}
        <button type="button" className="vc-link vc-live-title" onClick={() => view.actions.openMeeting(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
        <span className="vc-live-elapsed">{recording ? 'Capturing microphone and system audio' : 'Processing locally'}</span>
      </div>
      <ProgressBar value={null} label={meetingProgressLabel(meeting)} />
      <p className="vc-live-note">{artifactLine(meeting)}</p>
    </li>
  )
}

function RecentRow({ meeting, view }: { meeting: MeetingListItem; view: PrototypeView }) {
  return (
    <li className="vc-recent-row">
      <span className="vc-recent-time">{meetingTimeLabel(meeting)}</span>
      <button type="button" className="vc-recent-title" onClick={() => view.actions.openMeeting(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
      <span className="vc-recent-meta">{meetingDurationLabel(meeting)} · {artifactLine(meeting)}</span>
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
