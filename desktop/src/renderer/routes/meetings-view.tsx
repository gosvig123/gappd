import { artifactLabel, meetingStatusLabel, meetingStatusTone, processingStatusLabel } from '../components/meeting-status'

type MeetingListItem = Awaited<ReturnType<typeof window.gappd.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.gappd.meetings.show>>

type MeetingsViewProps = {
  meetings: MeetingListItem[]
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
  onRefresh: () => void
  onSelectMeeting: (id: string) => void
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

function MeetingRow({ meeting, selected, onSelect }: { meeting: MeetingListItem; selected: boolean; onSelect: (id: string) => void }) {
  const statusLabel = meetingStatusLabel(meeting.status.state)
  return (
    <button className={selected ? 'meeting-row selected' : 'meeting-row'} onClick={() => onSelect(meeting.id)} aria-pressed={selected}>
      <div className="meeting-row-top"><div className="meeting-row-body"><div className="meeting-title">{meeting.title}</div><div className="meeting-meta">{dateLabel(meeting.startedAt)}</div></div><div className={`status-pill ${meetingStatusTone(meeting.status.state)}`}>{statusLabel}</div></div>
      <div className="meeting-flags">
        <span className="meeting-tag">Capture · {meetingStatusLabel(meeting.status.capture.state)}</span>
        <span className="meeting-tag">AI · {processingStatusLabel(meeting.status.processing.state)}</span>
        <span className="meeting-tag">{artifactLabel(meeting.hasTranscript, 'Transcript ready', 'No transcript')}</span>
        <span className="meeting-tag">{artifactLabel(meeting.hasSummary, 'Summary ready', 'No summary')}</span>
      </div>
    </button>
  )
}

function MeetingDetailMeta({ selectedMeeting, selectedStatus }: { selectedMeeting: MeetingDetail; selectedStatus: MeetingDetail['status'] | undefined }) {
  return (
    <div className="detail-meta-grid">
      <div className="detail-stat"><span>Started</span><strong>{dateLabel(selectedMeeting.startedAt)}</strong></div>
      <div className="detail-stat"><span>Meeting ID</span><strong>{selectedMeeting.id}</strong></div>
      <div className="detail-stat"><span>Capture</span><strong>{selectedStatus ? meetingStatusLabel(selectedStatus.capture.state) : 'Unknown'}</strong></div>
      <div className="detail-stat"><span>AI</span><strong>{selectedStatus ? processingStatusLabel(selectedStatus.processing.state) : 'Unknown'}</strong></div>
    </div>
  )
}

function MeetingFailureState({ message }: { message?: string }) {
  if (!message) return null
  return <div className="detail-surface detail-alert">{message}</div>
}

function MeetingPipeline({ selectedStatus }: { selectedStatus: MeetingDetail['status'] }) {
  return (
    <div className="detail-surface"><div className="meeting-section-label">Pipeline</div><div className="detail-copy">Capture {meetingStatusLabel(selectedStatus.capture.state)} · updated {dateLabel(selectedStatus.capture.updatedAt)}</div><div className="detail-copy">AI {processingStatusLabel(selectedStatus.processing.state)} · updated {dateLabel(selectedStatus.processing.updatedAt)}</div></div>
  )
}

function MeetingsListPanel({ meetings, selectedMeetingId, onRefresh, onSelectMeeting }: Pick<MeetingsViewProps, 'meetings' | 'selectedMeetingId' | 'onRefresh' | 'onSelectMeeting'>) {
  return (
    <section className="panel list-panel">
      <div className="panel-header compact"><div><h1>Meetings</h1><p>{meetings.length} saved</p></div><button className="secondary" onClick={onRefresh}>Refresh</button></div>
      <div className="meeting-list">{meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === selectedMeetingId} onSelect={onSelectMeeting} />)}{meetings.length === 0 ? <div className="empty-state">No meetings yet.</div> : null}</div>
    </section>
  )
}

function MeetingDetailPanel({ selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onRefresh }: Pick<MeetingsViewProps, 'selectedMeetingId' | 'selectedMeeting' | 'selectedMeetingLoading' | 'selectedMeetingError' | 'transcript' | 'onRefresh'>) {
  if (selectedMeetingLoading) return <section className="panel detail-panel"><div className="empty-state">Loading meeting…</div></section>
  if (selectedMeetingError) return <section className="panel detail-panel"><div className="detail-surface detail-alert">{selectedMeetingError}</div></section>
  if (!selectedMeetingId || !selectedMeeting) return <section className="panel detail-panel"><div className="empty-state">Select a meeting to view details.</div></section>
  const selectedStatus = selectedMeeting.status
  return (
    <section className="panel detail-panel"><div className="panel-header"><div className="meeting-detail-title"><div className="meeting-section-label">Meeting detail</div><h1>{selectedMeeting.title}</h1><p className="meeting-detail-summary">Review the saved output, confirm capture finished cleanly, and inspect AI processing results.</p></div><button className="secondary" onClick={onRefresh}>Refresh</button></div><div className="detail-grid"><MeetingDetailMeta selectedMeeting={selectedMeeting} selectedStatus={selectedStatus} />{selectedStatus ? <MeetingPipeline selectedStatus={selectedStatus} /> : null}<MeetingFailureState message={selectedStatus?.capture.failureMessage} /><MeetingFailureState message={selectedStatus?.processing.failureMessage} /><div className="detail-surface detail-block"><div className="meeting-section-label">AI summary</div><pre>{selectedMeeting.summary || 'No AI summary yet.'}</pre></div><div className="detail-surface detail-block"><div className="meeting-section-label">Transcript</div><pre>{transcript || 'No transcript yet.'}</pre></div></div></section>
  )
}

export function MeetingsView({ meetings, selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onRefresh, onSelectMeeting }: MeetingsViewProps) {
  return (
    <>
      <MeetingsListPanel meetings={meetings} selectedMeetingId={selectedMeetingId} onRefresh={onRefresh} onSelectMeeting={onSelectMeeting} />
      <MeetingDetailPanel selectedMeetingId={selectedMeetingId} selectedMeeting={selectedMeeting} selectedMeetingLoading={selectedMeetingLoading} selectedMeetingError={selectedMeetingError} transcript={transcript} onRefresh={onRefresh} />
    </>
  )
}
