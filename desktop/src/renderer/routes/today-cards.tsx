import type { Device, MeetingListItem, RecordingStatus } from '../../shared/contracts'
import { meetingStatusLabel, meetingStatusTone, processingStatusLabel } from '../components/meeting-status'
import { Button, EmptyState, Panel, StatusPill } from '../components/ui'
import { dateLabel, EMPTY_TITLE, MAX_QUEUE_ITEMS, meetingSubtitle, readyState } from './today-model'

type CaptureCardProps = {
  title: string
  device: number
  devices: Device[]
  recordingStatus: RecordingStatus
  canStart: boolean
  canStop: boolean
  onTitleChange: (value: string) => void
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
}

export function CaptureCard(props: CaptureCardProps) {
  const state = readyState(props.canStart, props.canStop, props.devices, props.recordingStatus)
  return (
    <Panel className="inbox-capture-card">
      <div className="panel-header compact">
        <div><h1>Today</h1><p>Meeting inbox: capture, review, and keep notes moving.</p></div>
        <StatusPill tone={state.tone}>{state.title}</StatusPill>
      </div>
      <div className="record-control-card">
        <div><strong>{state.title}</strong><p className="record-intro">{state.detail}</p></div>
        <RecordFields {...props} />
        <div className="actions-row">
          <Button variant="primary" onClick={props.onStart} disabled={!props.canStart}>Start recording</Button>
          <Button onClick={props.onStop} disabled={!props.canStop}>Stop and process</Button>
        </div>
        <div className="record-state-line"><span className="label">Recorder</span><strong>{props.recordingStatus}</strong></div>
      </div>
    </Panel>
  )
}

export function QueueSection({ title, empty, meetings, onOpenMeeting }: { title: string; empty: string; meetings: MeetingListItem[]; onOpenMeeting: (id: string) => void }) {
  const visibleMeetings = meetings.slice(0, MAX_QUEUE_ITEMS)
  return (
    <Panel className="inbox-section">
      <div className="panel-header compact"><div><h2>{title}</h2><p>{meetings.length ? `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}` : empty}</p></div></div>
      <div className="inbox-card-list">
        {visibleMeetings.map((meeting) => <QueueCard key={meeting.id} meeting={meeting} onOpenMeeting={onOpenMeeting} />)}
        {!visibleMeetings.length ? <EmptyState className="compact-empty">{empty}</EmptyState> : null}
      </div>
    </Panel>
  )
}

export function LatestCard({ meeting, onOpenMeeting }: { meeting: MeetingListItem; onOpenMeeting: (id: string) => void }) {
  return (
    <Panel className="inbox-latest">
      <span className="label">Latest</span>
      <strong>{meeting.title || EMPTY_TITLE}</strong>
      <span>{meetingSubtitle(meeting)}</span>
      <Button onClick={() => onOpenMeeting(meeting.id)}>Open meeting</Button>
    </Panel>
  )
}

export function EmptyInbox() {
  return <Panel className="empty-state inbox-empty"><strong>No meetings yet.</strong><span>Start recording to create first inbox item.</span></Panel>
}

function QueueCard({ meeting, onOpenMeeting }: { meeting: MeetingListItem; onOpenMeeting: (id: string) => void }) {
  return (
    <button className="inbox-meeting-card" onClick={() => onOpenMeeting(meeting.id)}>
      <div className="meeting-row-top">
        <div className="meeting-row-body">
          <div className="meeting-title">{meeting.title || EMPTY_TITLE}</div>
          <div className="meeting-meta">{dateLabel(meeting.startedAt)}</div>
        </div>
        <StatusPill tone={meetingStatusTone(meeting.status.state)}>{meetingStatusLabel(meeting.status.state)}</StatusPill>
      </div>
      <p>{meetingSubtitle(meeting)}</p>
      <div className="record-meeting-meta">
        <span>AI {processingStatusLabel(meeting.status.processing.state)}</span>
        <span>{meeting.hasSummary ? 'Summary ready' : 'Summary pending'}</span>
        <span>{meeting.hasTranscript ? 'Transcript ready' : 'Transcript pending'}</span>
      </div>
    </button>
  )
}

function RecordFields({ title, device, devices, onTitleChange, onDeviceChange }: Pick<CaptureCardProps, 'title' | 'device' | 'devices' | 'onTitleChange' | 'onDeviceChange'>) {
  return (
    <div className="record-fields">
      <label><span>Meeting title</span><input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Sprint planning" /></label>
      <label><span>Audio input</span><select value={device} onChange={(event) => onDeviceChange(Number(event.target.value))}>{devices.map((item) => <option key={item.index} value={item.index}>[{item.index}] {item.name}</option>)}</select></label>
    </div>
  )
}
