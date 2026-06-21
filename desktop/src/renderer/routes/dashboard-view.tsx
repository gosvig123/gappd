import type { Device, MeetingDetail, MeetingListItem, RecordingStatus } from '../../shared/contracts'
import { meetingStatusLabel, meetingStatusTone } from '../components/meeting-status'
import { EmptyState, ListRow, PageHeader, Panel, StatusPill } from '../components/ui'
import { MeetingDetailPanel } from './meeting-detail-view'
import { CaptureCard } from './today-cards'
import './meetings.css'
import './today.css'
import { dateLabel, EMPTY_TITLE } from './today-model'

const MEETING_CAPTURED = 'captured'
const MEETING_RECORDING = 'recording'
const PROCESSING_PROCESSING = 'processing'

type DashboardViewProps = {
  device: number
  devices: Device[]
  meetings: MeetingListItem[]
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
  recordingStatus: RecordingStatus
  canStart: boolean
  canStop: boolean
  onDeviceChange: (value: number) => void
  onStart: () => void
  onStop: () => void
  onSelectMeeting: (id: string) => void
}

export function DashboardView(props: DashboardViewProps) {
  return (
    <div className="dashboard-grid ui-density-compact">
      <CaptureCard {...props} />
      <div className="dashboard-workspace">
        <MeetingInboxPanel meetings={props.meetings} selectedMeetingId={props.selectedMeetingId} onSelectMeeting={props.onSelectMeeting} />
        <div className="dashboard-detail-column">
          <MeetingDetailPanel selectedMeetingId={props.selectedMeetingId} selectedMeeting={props.selectedMeeting} selectedMeetingLoading={props.selectedMeetingLoading} selectedMeetingError={props.selectedMeetingError} transcript={props.transcript} />
        </div>
      </div>
    </div>
  )
}

function MeetingInboxPanel(props: { meetings: MeetingListItem[]; selectedMeetingId: string | null; onSelectMeeting: (id: string) => void }) {
  const visibleText = `${props.meetings.length} meetings shown`
  return (
    <Panel className="list-panel dashboard-inbox-panel">
      <PageHeader className="compact inbox-panel-header" title="Meeting inbox" description={visibleText} />
      <div className="meeting-list">
        {props.meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === props.selectedMeetingId} onSelect={props.onSelectMeeting} />)}
        {props.meetings.length === 0 ? <EmptyState className="meetings-empty">Recorded meetings appear here.</EmptyState> : null}
      </div>
    </Panel>
  )
}

function MeetingRow({ meeting, selected, onSelect }: { meeting: MeetingListItem; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <ListRow className="meeting-row" selected={selected} onClick={() => onSelect(meeting.id)}>
      <div className="meeting-row-top">
        <div className="meeting-row-body"><div className="meeting-title">{meeting.title || EMPTY_TITLE}</div>{meeting.title !== dateLabel(meeting.startedAt) ? <div className="meeting-meta">{dateLabel(meeting.startedAt)}</div> : null}</div>
        <StatusPill tone={meetingStatusTone(meeting.status.state)}>{meetingStatusLabel(meeting.status.state)}</StatusPill>
      </div>
      <div className="meeting-row-summary">{artifactSummary(meeting)}</div>
    </ListRow>
  )
}

function artifactSummary(meeting: MeetingListItem): string {
  if (meeting.status.state === MEETING_RECORDING) return 'Recording now · transcript after stop…'
  if (meeting.status.processing.state === PROCESSING_PROCESSING && !meeting.hasTranscript) return 'Transcribing audio and preparing summary…'
  if (meeting.status.processing.state === PROCESSING_PROCESSING) return 'Transcript ready · creating summary…'
  if (meeting.status.state === MEETING_CAPTURED) return 'Audio captured · waiting to process'
  if (meeting.hasSummary && meeting.hasTranscript) return 'Summary + transcript ready'
  if (meeting.hasSummary) return 'Summary ready'
  if (meeting.hasTranscript) return 'Transcript ready'
  return 'Artifacts pending'
}
