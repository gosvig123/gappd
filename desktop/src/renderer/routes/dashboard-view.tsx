import { useEffect, useMemo, useState } from 'react'
import type { Device, MeetingDetail, MeetingListItem, RecordingStatus } from '../../shared/contracts'
import { meetingStatusLabel, meetingStatusPillVisible, meetingStatusTone } from '../components/meeting-status'
import { Button, EmptyState, ListRow, PageHeader, Panel, StatusPill } from '../components/ui'
import { MeetingDetailPanel } from './meeting-detail-view'
import { CaptureCard } from './today-cards'
import './meetings.css'
import './today.css'
import { dateLabel, EMPTY_TITLE } from './today-model'

const MEETING_CAPTURED = 'captured'
const MEETING_RECORDING = 'recording'
const PROCESSING_PROCESSING = 'processing'
const MEETING_LIST_SHORTCUT = 'b'
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
  const [meetingListOpen, setMeetingListOpen] = useState(true)
  const meetings = useMemo(() => filterMeetings(props.meetings, query), [props.meetings, query])
  useMeetingListShortcut(() => setMeetingListOpen((current) => !current))
  return (
    <div className="dashboard-grid ui-density-compact">
      <div className={meetingListOpen ? 'dashboard-workspace' : 'dashboard-workspace meeting-list-collapsed'}>
        {meetingListOpen ? <MeetingInboxPanel allMeetingsCount={props.meetings.length} meetings={meetings} query={query} selectedMeetingId={props.selectedMeetingId} onCollapse={() => setMeetingListOpen(false)} onQueryChange={setQuery} onSelectMeeting={props.onSelectMeeting} /> : <MeetingListRestore onExpand={() => setMeetingListOpen(true)} />}
        <div className="dashboard-detail-column"><MeetingDetailPanel selectedMeetingId={props.selectedMeetingId} selectedMeeting={props.selectedMeeting} selectedMeetingLoading={props.selectedMeetingLoading} selectedMeetingError={props.selectedMeetingError} transcript={props.transcript} onDeleteMeeting={props.onDeleteMeeting} /></div>
      </div>
      <CaptureCard {...props} />
    </div>
  )
}

function useMeetingListShortcut(onToggle: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isMeetingListShortcut(event)) return
      event.preventDefault()
      onToggle()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggle])
}

function MeetingListRestore({ onExpand }: { onExpand: () => void }) {
  return <button className="meeting-list-restore" onClick={onExpand} aria-label="Show meetings" title="Show meetings (⌘B)"><span aria-hidden="true">☰</span></button>
}

function MeetingInboxPanel(props: { allMeetingsCount: number; meetings: MeetingListItem[]; query: string; selectedMeetingId: string | null; onCollapse: () => void; onQueryChange: (value: string) => void; onSelectMeeting: (id: string) => void }) {
  const visibleText = props.query ? `${props.meetings.length} of ${props.allMeetingsCount} meetings` : `${props.allMeetingsCount} meetings`
  const groups = groupMeetingsByDate(props.meetings)
  return (
    <Panel className="list-panel dashboard-inbox-panel">
      <PageHeader className="compact inbox-panel-header" title="Meetings" description={visibleText} action={<Button className="compact-action meeting-list-toggle" onClick={props.onCollapse} title="Hide meetings (⌘B)">Hide</Button>} />
      <input className="meeting-search" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Search meetings" aria-label="Search meetings" />
      <div className="meeting-list">
        {groups.map((group) => <MeetingDateSection key={group.key} group={group} selectedMeetingId={props.selectedMeetingId} onSelect={props.onSelectMeeting} />)}
        {props.meetings.length === 0 ? <EmptyState className="meetings-empty">No matching meetings.</EmptyState> : null}
      </div>
    </Panel>
  )
}

function MeetingDateSection({ group, selectedMeetingId, onSelect }: { group: MeetingDateGroup; selectedMeetingId: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="meeting-date-section" aria-label={group.title}>
      <div className="meeting-date-heading"><span>{group.title}</span><span>{group.meetings.length}</span></div>
      <div className="meeting-date-items">{group.meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === selectedMeetingId} onSelect={onSelect} />)}</div>
    </section>
  )
}

function isMeetingListShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === MEETING_LIST_SHORTCUT
}

function MeetingRow({ meeting, selected, onSelect }: { meeting: MeetingListItem; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <ListRow className="meeting-row" selected={selected} onClick={() => onSelect(meeting.id)}>
      <div className="meeting-row-top">
        <div className="meeting-row-body"><div className="meeting-title">{meeting.title || EMPTY_TITLE}</div>{meeting.title !== dateLabel(meeting.startedAt) ? <div className="meeting-meta">{dateLabel(meeting.startedAt)}</div> : null}</div>
        {meetingStatusPillVisible(meeting.status.state) ? <StatusPill tone={meetingStatusTone(meeting.status.state)}>{meetingStatusLabel(meeting.status.state)}</StatusPill> : null}
      </div>
      <div className="meeting-row-summary">{artifactSummary(meeting)}</div>
    </ListRow>
  )
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
  if (meeting.status.processing.state === PROCESSING_PROCESSING && !meeting.hasTranscript) return 'Transcribing audio and preparing summary…'
  if (meeting.status.processing.state === PROCESSING_PROCESSING) return 'Transcript ready · creating summary…'
  if (meeting.status.state === MEETING_CAPTURED) return 'Audio captured · waiting to process'
  if (meeting.hasSummary && meeting.hasTranscript) return 'Summary + transcript ready'
  if (meeting.hasSummary) return 'Summary ready'
  if (meeting.hasTranscript) return 'Transcript ready'
  return 'Artifacts pending'
}
