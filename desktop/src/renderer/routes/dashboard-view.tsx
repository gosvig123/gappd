import { useMemo, useState } from 'react'
import type { Device, MeetingDetail, MeetingListItem, RecordingStatus } from '../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../components/meeting-status'
import { meetingProgressLabel, type MeetingProgressInput } from '../components/meeting-progress'
import { EmptyState, ListRow, PageHeader, StatusPill } from '../components/ui'
import { MeetingDetailPanel } from './meeting-detail-view'
import { RecordControls } from './today-cards'
import './meetings.css'
import './today.css'
import { dateLabel, EMPTY_TITLE } from './today-model'

const MEETING_CAPTURED = 'captured'
const MEETING_RECORDING = 'recording'
const PROCESSING_PROCESSING = 'processing'
const DAY_MS = 24 * 60 * 60 * 1000
const LAST_7_DAYS_WINDOW = 7
const DATE_SECTION_TODAY = 'today'
const DATE_SECTION_LAST_7_DAYS = 'last7Days'
const DATE_SECTION_EARLIER = 'earlier'
const DATE_SECTION_ORDER = [DATE_SECTION_TODAY, DATE_SECTION_LAST_7_DAYS, DATE_SECTION_EARLIER] as const
const DATE_SECTION_TITLES = {
  [DATE_SECTION_TODAY]: 'Today',
  [DATE_SECTION_LAST_7_DAYS]: 'Last 7 days',
  [DATE_SECTION_EARLIER]: 'Earlier',
} as const

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
  onClearSelection: () => void
  onDeleteMeeting: (id: string) => Promise<void>
}

type MeetingDateSectionKey = (typeof DATE_SECTION_ORDER)[number]

type MeetingDateGroup = {
  key: MeetingDateSectionKey
  title: string
  meetings: MeetingListItem[]
}

export function DashboardView(props: DashboardViewProps) {
  const [query, setQuery] = useState('')
  const meetings = useMemo(() => filterMeetings(props.meetings, query), [props.meetings, query])
  const open = Boolean(props.selectedMeetingId)
  return (
    <div className="dashboard-grid ui-density-compact">
      <div className={open ? 'dashboard-stage is-detail' : 'dashboard-stage is-list'}>
        {open ? (
          <MeetingDetailScreen selectedMeetingId={props.selectedMeetingId} selectedMeeting={props.selectedMeeting} selectedMeetingLoading={props.selectedMeetingLoading} selectedMeetingError={props.selectedMeetingError} transcript={props.transcript} onDeleteMeeting={props.onDeleteMeeting} onBack={props.onClearSelection} record={props} />
        ) : (
          <MeetingListScreen allMeetingsCount={props.meetings.length} meetings={meetings} query={query} onQueryChange={setQuery} onSelectMeeting={props.onSelectMeeting} record={props} />
        )}
      </div>
    </div>
  )
}

function MeetingListScreen(props: { allMeetingsCount: number; meetings: MeetingListItem[]; query: string; onQueryChange: (value: string) => void; onSelectMeeting: (id: string) => void; record: DashboardViewProps }) {
  const visibleText = props.query ? `${props.meetings.length} of ${props.allMeetingsCount} meetings` : meetingCountLabel(props.allMeetingsCount)
  const groups = groupMeetingsByDate(props.meetings)
  return (
    <div className="meeting-list-screen">
      <PageHeader className="compact meetings-header" title="Meetings" description={visibleText} action={<RecordControls device={props.record.device} devices={props.record.devices} recordingStatus={props.record.recordingStatus} canStart={props.record.canStart} canStop={props.record.canStop} onDeviceChange={props.record.onDeviceChange} onStart={props.record.onStart} onStop={props.record.onStop} />} />
      <input className="meeting-search" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Search meetings" aria-label="Search meetings" />
      <div className="meeting-list">
        {groups.map((group) => <MeetingDateSection key={group.key} group={group} onSelect={props.onSelectMeeting} />)}
        {props.meetings.length === 0 ? <EmptyState className="meetings-empty">{props.allMeetingsCount === 0 ? 'No meetings yet. Start recording to capture one.' : 'No matching meetings.'}</EmptyState> : null}
      </div>
    </div>
  )
}

function MeetingDetailScreen(props: { selectedMeetingId: string | null; selectedMeeting: MeetingDetail | null; selectedMeetingLoading: boolean; selectedMeetingError: string | null; transcript: string; onDeleteMeeting: (id: string) => Promise<void>; onBack: () => void; record: DashboardViewProps }) {
  return (
    <div className="meeting-detail-screen">
      <div className="detail-topbar">
        <button className="back-link" onClick={props.onBack}><span aria-hidden="true">←</span> All meetings</button>
        <RecordControls device={props.record.device} devices={props.record.devices} recordingStatus={props.record.recordingStatus} canStart={props.record.canStart} canStop={props.record.canStop} onDeviceChange={props.record.onDeviceChange} onStart={props.record.onStart} onStop={props.record.onStop} />
      </div>
      <MeetingDetailPanel selectedMeetingId={props.selectedMeetingId} selectedMeeting={props.selectedMeeting} selectedMeetingLoading={props.selectedMeetingLoading} selectedMeetingError={props.selectedMeetingError} transcript={props.transcript} onDeleteMeeting={props.onDeleteMeeting} />
    </div>
  )
}

function MeetingDateSection({ group, onSelect }: { group: MeetingDateGroup; onSelect: (id: string) => void }) {
  return (
    <section className="meeting-date-section" aria-label={group.title}>
      <div className="meeting-date-heading"><span>{group.title}</span><span>{group.meetings.length}</span></div>
      <div className="meeting-date-items">{group.meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} onSelect={onSelect} />)}</div>
    </section>
  )
}

function MeetingRow({ meeting, onSelect }: { meeting: MeetingListItem; onSelect: (id: string) => void }) {
  const progress = listProgressInput(meeting)
  return (
    <ListRow className="meeting-row" onClick={() => onSelect(meeting.id)}>
      <div className="meeting-row-top">
        <div className="meeting-row-body"><div className="meeting-title">{meeting.title || EMPTY_TITLE}</div>{meeting.title !== dateLabel(meeting.startedAt) ? <div className="meeting-meta">{dateLabel(meeting.startedAt)}</div> : null}</div>
        {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{meetingProgressLabel(progress)}</StatusPill> : null}
      </div>
      <div className="meeting-row-summary">{artifactSummary(meeting)}</div>
    </ListRow>
  )
}

function meetingCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'meeting' : 'meetings'}`
}

function filterMeetings(meetings: MeetingListItem[], query: string): MeetingListItem[] {
  const term = query.trim().toLowerCase()
  if (!term) return meetings
  return meetings.filter((meeting) => meetingSearchText(meeting).includes(term))
}

function groupMeetingsByDate(meetings: MeetingListItem[]): MeetingDateGroup[] {
  const buckets = emptyDateBuckets()
  for (const meeting of meetings) buckets[dateSectionKey(meeting.startedAt)].push(meeting)
  return DATE_SECTION_ORDER.flatMap((key) => buckets[key].length ? [{ key, title: DATE_SECTION_TITLES[key], meetings: buckets[key] }] : [])
}

function emptyDateBuckets(): Record<MeetingDateSectionKey, MeetingListItem[]> {
  return { [DATE_SECTION_TODAY]: [], [DATE_SECTION_LAST_7_DAYS]: [], [DATE_SECTION_EARLIER]: [] }
}

function dateSectionKey(value: string, now = new Date()): MeetingDateSectionKey {
  const startedAt = new Date(value).getTime()
  if (!Number.isFinite(startedAt)) return DATE_SECTION_EARLIER
  const todayStart = startOfLocalDay(now).getTime()
  if (startedAt >= todayStart && startedAt < todayStart + DAY_MS) return DATE_SECTION_TODAY
  if (startedAt >= todayStart - LAST_7_DAYS_WINDOW * DAY_MS) return DATE_SECTION_LAST_7_DAYS
  return DATE_SECTION_EARLIER
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function meetingSearchText(meeting: MeetingListItem): string {
  return [meeting.title || EMPTY_TITLE, dateLabel(meeting.startedAt), artifactSummary(meeting), meeting.searchText ?? ''].join(' ').toLowerCase()
}

function artifactSummary(meeting: MeetingListItem): string {
  if (meeting.status.state === MEETING_RECORDING) return 'Recording now · transcript after stop…'
  if (meeting.status.processing.state === PROCESSING_PROCESSING && !meeting.hasTranscript) return 'Transcribing audio locally…'
  if (meeting.status.processing.state === PROCESSING_PROCESSING && !meeting.hasSummary) return 'Creating summary locally…'
  if (meeting.status.processing.state === PROCESSING_PROCESSING) return 'Finalizing notes…'
  if (meeting.status.state === MEETING_CAPTURED) return 'Audio captured · waiting to process'
  if (meeting.hasSummary && meeting.hasTranscript) return 'Notes available'
  if (meeting.hasSummary) return 'Notes available'
  if (meeting.hasTranscript) return 'Transcript available'
  return 'Artifacts pending'
}

function listProgressInput(meeting: MeetingListItem): MeetingProgressInput {
  return { status: meeting.status, hasTranscript: meeting.hasTranscript, hasSummary: meeting.hasSummary }
}
