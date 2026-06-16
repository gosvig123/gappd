import { useMemo, useState } from 'react'
import type { Device, MeetingDetail, MeetingListItem, RecordingStatus } from '../../shared/contracts'
import { meetingStatusLabel, meetingStatusTone } from '../components/meeting-status'
import { EmptyState, ListRow, PageHeader, Panel, StatusPill } from '../components/ui'
import { MeetingDetailPanel } from './meeting-detail-view'
import { CaptureCard } from './today-cards'
import './meetings.css'
import './today.css'
import { buildInboxCounts, dateLabel, EMPTY_TITLE, filterInboxMeetings, INBOX_ALL, INBOX_FILTERS, INBOX_PROCESSING, INBOX_READY, type InboxCounts, type InboxFilter } from './today-model'

const INBOX_LABELS: Record<InboxFilter, string> = {
  [INBOX_READY]: 'Ready',
  [INBOX_PROCESSING]: 'Processing',
  [INBOX_ALL]: 'All',
}

const INBOX_EMPTY: Record<InboxFilter, string> = {
  [INBOX_READY]: 'No summaries or transcripts ready yet.',
  [INBOX_PROCESSING]: 'No meetings processing now.',
  [INBOX_ALL]: 'Recorded meetings appear here.',
}

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
  const [filter, setFilter] = useState<InboxFilter>(INBOX_ALL)
  const counts = useMemo(() => buildInboxCounts(props.meetings), [props.meetings])
  const meetings = useMemo(() => filterInboxMeetings(props.meetings, filter), [filter, props.meetings])
  return (
    <div className="dashboard-grid ui-density-compact">
      <CaptureCard {...props} />
      <div className="dashboard-workspace">
        <MeetingInboxPanel counts={counts} filter={filter} meetings={meetings} selectedMeetingId={props.selectedMeetingId} totalMeetings={props.meetings.length} onFilterChange={setFilter} onSelectMeeting={props.onSelectMeeting} />
        <div className="dashboard-detail-column">
          <MeetingDetailPanel selectedMeetingId={props.selectedMeetingId} selectedMeeting={props.selectedMeeting} selectedMeetingLoading={props.selectedMeetingLoading} selectedMeetingError={props.selectedMeetingError} transcript={props.transcript} />
        </div>
      </div>
    </div>
  )
}

function MeetingInboxPanel(props: { counts: InboxCounts; filter: InboxFilter; meetings: MeetingListItem[]; selectedMeetingId: string | null; totalMeetings: number; onFilterChange: (filter: InboxFilter) => void; onSelectMeeting: (id: string) => void }) {
  const visibleText = `${props.meetings.length} of ${props.totalMeetings} meetings shown`
  return (
    <Panel className="list-panel dashboard-inbox-panel">
      <PageHeader className="compact inbox-panel-header" title="Meeting inbox" description={visibleText} />
      <FilterChips counts={props.counts} value={props.filter} onChange={props.onFilterChange} />
      <div className="meeting-list">
        {props.meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === props.selectedMeetingId} onSelect={props.onSelectMeeting} />)}
        {props.meetings.length === 0 ? <EmptyState className="meetings-empty">{INBOX_EMPTY[props.filter]}</EmptyState> : null}
      </div>
    </Panel>
  )
}

function FilterChips({ counts, value, onChange }: { counts: InboxCounts; value: InboxFilter; onChange: (filter: InboxFilter) => void }) {
  return (
    <div className="filter-chips" aria-label="Meeting filters">
      {INBOX_FILTERS.map((filter) => <button key={filter} className={filter === value ? 'filter-chip active' : 'filter-chip'} onClick={() => onChange(filter)} aria-pressed={filter === value}>{INBOX_LABELS[filter]} <span>{counts[filter]}</span></button>)}
    </div>
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
  if (meeting.hasSummary && meeting.hasTranscript) return 'Summary + transcript ready'
  if (meeting.hasSummary) return 'Summary ready'
  if (meeting.hasTranscript) return 'Transcript ready'
  return 'Artifacts pending'
}
