import type { MeetingDetail, MeetingListItem } from '../../shared/contracts'
import { meetingStatusLabel, meetingStatusTone } from '../components/meeting-status'
import './meetings.css'
import { Button, EmptyState, Panel, StatusPill } from '../components/ui'
import { MeetingDetailPanel } from './meeting-detail-view'

type MeetingsViewProps = {
  meetings: MeetingListItem[]
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
  onRefresh: () => void
  onSelectMeeting: (id: string) => void
  onRecordFirst: () => void
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

function artifactSummary(meeting: MeetingListItem): string {
  if (meeting.hasSummary && meeting.hasTranscript) return 'Summary + transcript ready'
  if (meeting.hasSummary) return 'Summary ready'
  if (meeting.hasTranscript) return 'Transcript ready'
  return 'Artifacts pending'
}

function MeetingRow({ meeting, selected, onSelect }: { meeting: MeetingListItem; selected: boolean; onSelect: (id: string) => void }) {
  const tone = meetingStatusTone(meeting.status.state)
  return (
    <button className={selected ? 'meeting-row selected' : 'meeting-row'} onClick={() => onSelect(meeting.id)} aria-pressed={selected}>
      <div className="meeting-row-top">
        <div className="meeting-row-body">
          <div className="meeting-title">{meeting.title}</div>
          <div className="meeting-meta">{dateLabel(meeting.startedAt)}</div>
        </div>
        <StatusPill tone={tone}>{meetingStatusLabel(meeting.status.state)}</StatusPill>
      </div>
      <div className="meeting-row-summary">{artifactSummary(meeting)}</div>
    </button>
  )
}

function MeetingsEmptyState({ onRecordFirst }: { onRecordFirst: () => void }) {
  return (
    <EmptyState className="meetings-empty">
      <strong>No meetings yet.</strong>
      <span>Record first meeting to create summary and transcript.</span>
      <Button variant="primary" onClick={onRecordFirst}>Record first meeting</Button>
    </EmptyState>
  )
}

function MeetingsListPanel({ meetings, selectedMeetingId, onRefresh, onSelectMeeting, onRecordFirst }: Pick<MeetingsViewProps, 'meetings' | 'selectedMeetingId' | 'onRefresh' | 'onSelectMeeting' | 'onRecordFirst'>) {
  return (
    <Panel className="list-panel">
      <div className="panel-header compact">
        <div><h1>Meetings</h1><p>{meetings.length} saved sessions</p></div>
        <Button onClick={onRefresh}>Refresh</Button>
      </div>
      <div className="meeting-list">
        {meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === selectedMeetingId} onSelect={onSelectMeeting} />)}
        {meetings.length === 0 ? <MeetingsEmptyState onRecordFirst={onRecordFirst} /> : null}
      </div>
    </Panel>
  )
}

export function MeetingsView(props: MeetingsViewProps) {
  return (
    <>
      <MeetingsListPanel meetings={props.meetings} selectedMeetingId={props.selectedMeetingId} onRefresh={props.onRefresh} onSelectMeeting={props.onSelectMeeting} onRecordFirst={props.onRecordFirst} />
      <MeetingDetailPanel selectedMeetingId={props.selectedMeetingId} selectedMeeting={props.selectedMeeting} selectedMeetingLoading={props.selectedMeetingLoading} selectedMeetingError={props.selectedMeetingError} transcript={props.transcript} onRefresh={props.onRefresh} />
    </>
  )
}
