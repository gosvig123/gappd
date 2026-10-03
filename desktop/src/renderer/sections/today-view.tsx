import { CalendarDays, CircleAlert, Clock, MapPin, Video } from 'lucide-react'
import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../shared/meeting-recording-workflow'
import { meetingHasWork, meetingProgressLabel } from '../components/meeting-progress'
import { Button, ProgressBar, StatusPill, cx } from '../components/ui'
import { artifactLine, artifactNote, eventIsNow, eventPeople, eventPlace, eventTimeRange, upcomingEvents, type AppView } from '../lib/app-view'
import { dayLabel, durationLabel, meetingDurationLabel } from '../lib/meeting-grouping'
import { EventAgendaChip, MeetingAgendaChip } from '../components/agenda-tab'
import { useOpenMeeting } from '../components/meeting-open-scope'

type TodayProps = { view: AppView; onOpenMeetings: () => void; onOpenCalendar: () => void }

export function TodayView({ view, onOpenMeetings, onOpenCalendar }: TodayProps) {
  const events = todayTimeline(view.calendar)
  const work = view.meetings.filter(meetingHasWork)
  return (
    <div className="app-stack">
      <header className="app-section-head">
        <h1 className="ui-title">Today</h1>
        <p className="app-today-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </header>
      {work.length ? <ul className="app-live">{work.map((meeting) => <LiveCard key={meeting.id} meeting={meeting} view={view} />)}</ul> : null}
      <section className="app-block" aria-label="Schedule">
        <BlockHead title="Schedule" action={{ label: 'Upcoming', onClick: onOpenCalendar }} />
        {events.length ? <Timeline events={events} view={view} /> : <UpNext view={view} />}
      </section>
      <section className="app-block" aria-label="Recent meetings">
        <BlockHead title="Recent meetings" action={{ label: 'All meetings', onClick: onOpenMeetings }} />
        <RecentDays meetings={view.meetings.slice(0, 5)} view={view} />
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
  const past = !now && new Date(event.end).getTime() < Date.now()
  const people = eventPeople(event)
  const place = eventPlace(event)
  const Place = place?.call ? Video : MapPin
  return (
    <li className={cx('app-timeline-row', past && 'is-past', now && 'is-now', next && 'is-next')}>
      <div className="app-timeline-when">
        <strong>{now ? 'Now' : clockOf(event)}</strong>
        <span>{durationLabel(event.start, event.end)}</span>
      </div>
      <div className="app-timeline-copy">
        <strong>{event.title}</strong>
        <div className="app-timeline-sub">
          {people ? <span>{people}</span> : null}
          {place ? <span className="app-timeline-place"><Place aria-hidden="true" />{place.label}</span> : null}
          <EventAgendaChip view={view} event={event} />
        </div>
      </div>
      {past ? null : <Button variant={now || next ? 'primary' : 'secondary'} className={cx('compact-action', !(now || next) && 'app-reveal')} disabled={!view.canStart} title={view.canStart ? undefined : 'Connect an audio input to record'} onClick={() => view.actions.start(event.sourceId)}>Record</Button>}
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

function RecentDays({ meetings, view }: { meetings: MeetingListItem[]; view: AppView }) {
  const days = new Map<string, MeetingListItem[]>()
  for (const meeting of meetings) days.set(dayLabel(meeting.startedAt), [...(days.get(dayLabel(meeting.startedAt)) ?? []), meeting])
  return (
    <div className="app-recent">
      {[...days].map(([day, items]) => (
        <section key={day} className="app-recent-day" aria-label={day}>
          <h3>{day}</h3>
          <ul>{items.map((meeting) => <RecentRow key={meeting.id} meeting={meeting} view={view} />)}</ul>
        </section>
      ))}
    </div>
  )
}

function RecentRow({ meeting, view }: { meeting: MeetingListItem; view: AppView }) {
  const open = useOpenMeeting(view.actions.openMeeting)
  const note = artifactNote(meeting)
  const failed = meeting.status.state === 'failed'
  return (
    <li className="app-recent-row">
      <span className="app-recent-time">{new Date(meeting.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      <button type="button" className="app-recent-title" onClick={() => open(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
      <span className="app-recent-meta">
        {note ? <span className={cx('app-recent-note', failed && 'is-failed')}>{failed ? <CircleAlert aria-hidden="true" /> : null}{note}</span> : null}
        <MeetingAgendaChip view={view} meetingId={meeting.id} onOpen={() => open(meeting.id, 'agenda')} />
        <span className="app-recent-duration">{meetingDurationLabel(meeting)}</span>
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
