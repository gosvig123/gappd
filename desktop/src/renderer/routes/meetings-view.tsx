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
  onRecordFirst: () => void
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

function MeetingRow({ meeting, selected, onSelect }: { meeting: MeetingListItem; selected: boolean; onSelect: (id: string) => void }) {
  const statusLabel = meetingStatusLabel(meeting.status.state)
  const artifactState = meeting.hasSummary || meeting.hasTranscript ? 'Ready' : 'Pending'
  return (
    <button className={selected ? 'meeting-row selected' : 'meeting-row'} onClick={() => onSelect(meeting.id)} aria-pressed={selected}>
      <div className="meeting-row-top"><div className="meeting-row-body"><div className="meeting-title">{meeting.title}</div><div className="meeting-meta">{dateLabel(meeting.startedAt)}</div></div><div className={`status-pill ${meetingStatusTone(meeting.status.state)}`}>{statusLabel}</div></div>
      <div className="meeting-row-summary">
        <span>{artifactState}</span>
        <span>{meeting.hasSummary ? 'Summary available' : 'No summary yet'}</span>
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

function MeetingArtifacts({ hasTranscript, hasSummary }: { hasTranscript: boolean; hasSummary: boolean }) {
  return (
    <div className="detail-surface detail-block">
      <div className="meeting-section-label">Artifacts</div>
      <div className="meeting-flags"><span className="meeting-tag">{artifactLabel(hasTranscript, 'Transcript ready', 'No transcript')}</span><span className="meeting-tag">{artifactLabel(hasSummary, 'Summary ready', 'No summary')}</span></div>
    </div>
  )
}

function MeetingDiagnostics({ selectedMeeting, selectedStatus, hasTranscript, hasSummary }: { selectedMeeting: MeetingDetail; selectedStatus: MeetingDetail['status'] | undefined; hasTranscript: boolean; hasSummary: boolean }) {
  return (
    <details className="detail-surface detail-block">
      <summary className="meeting-section-label">Diagnostics</summary>
      <MeetingDetailMeta selectedMeeting={selectedMeeting} selectedStatus={selectedStatus} />
      {selectedStatus ? <MeetingPipeline selectedStatus={selectedStatus} /> : null}
      <MeetingArtifacts hasTranscript={hasTranscript} hasSummary={hasSummary} />
    </details>
  )
}

function MeetingsEmptyState({ onRecordFirst }: { onRecordFirst: () => void }) {
  return (
    <div className="empty-state">
      <strong>No meetings yet.</strong>
      <span>Record first meeting to create summary and transcript.</span>
      <button className="primary" onClick={onRecordFirst}>Record first meeting</button>
    </div>
  )
}

function MeetingsListPanel({ meetings, selectedMeetingId, onRefresh, onSelectMeeting, onRecordFirst }: Pick<MeetingsViewProps, 'meetings' | 'selectedMeetingId' | 'onRefresh' | 'onSelectMeeting' | 'onRecordFirst'>) {
  return (
    <section className="panel list-panel">
      <div className="panel-header compact"><div><h1>Meetings</h1><p>{meetings.length} saved sessions</p></div><button className="secondary" onClick={onRefresh}>Refresh</button></div>
      <div className="meeting-list">{meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === selectedMeetingId} onSelect={onSelectMeeting} />)}{meetings.length === 0 ? <MeetingsEmptyState onRecordFirst={onRecordFirst} /> : null}</div>
    </section>
  )
}

function MeetingDetailPanel({ selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onRefresh }: Pick<MeetingsViewProps, 'selectedMeetingId' | 'selectedMeeting' | 'selectedMeetingLoading' | 'selectedMeetingError' | 'transcript' | 'onRefresh'>) {
  if (selectedMeetingLoading) return <section className="panel detail-panel"><div className="empty-state">Loading meeting…</div></section>
  if (selectedMeetingError) return <section className="panel detail-panel"><div className="detail-surface detail-alert">{selectedMeetingError}</div></section>
  if (!selectedMeetingId || !selectedMeeting) return <section className="panel detail-panel"><div className="empty-state">Select a meeting to view details.</div></section>
  const selectedStatus = selectedMeeting.status
  const hasTranscript = Boolean(transcript)
  const hasSummary = Boolean(selectedMeeting.summary)
  return (
    <section className="panel detail-panel"><div className="panel-header"><div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1><p className="meeting-detail-summary">Review summary and transcript.</p></div><button className="secondary" onClick={onRefresh}>Refresh</button></div><div className="detail-grid"><div className="detail-surface detail-block"><div className="meeting-section-label">AI summary</div><pre>{selectedMeeting.summary || 'No AI summary yet.'}</pre></div><div className="detail-surface detail-block"><div className="meeting-section-label">Transcript</div><pre>{transcript || 'No transcript yet.'}</pre></div><MeetingFailureState message={selectedStatus?.capture.failureMessage} /><MeetingFailureState message={selectedStatus?.processing.failureMessage} /><MeetingDiagnostics selectedMeeting={selectedMeeting} selectedStatus={selectedStatus} hasTranscript={hasTranscript} hasSummary={hasSummary} /></div></section>
  )
}

export function MeetingsView({ meetings, selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onRefresh, onSelectMeeting, onRecordFirst }: MeetingsViewProps) {
  return (
    <>
      <MeetingsListPanel meetings={meetings} selectedMeetingId={selectedMeetingId} onRefresh={onRefresh} onSelectMeeting={onSelectMeeting} onRecordFirst={onRecordFirst} />
      <MeetingDetailPanel selectedMeetingId={selectedMeetingId} selectedMeeting={selectedMeeting} selectedMeetingLoading={selectedMeetingLoading} selectedMeetingError={selectedMeetingError} transcript={transcript} onRefresh={onRefresh} />
    </>
  )
}
