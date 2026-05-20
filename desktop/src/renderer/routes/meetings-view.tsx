import { type ReactNode, useEffect, useState } from 'react'
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

function artifactSummary(meeting: MeetingListItem): string {
  if (meeting.hasSummary && meeting.hasTranscript) return 'Summary + transcript ready'
  if (meeting.hasSummary) return 'Summary ready'
  if (meeting.hasTranscript) return 'Transcript ready'
  return 'Artifacts pending'
}

function canCopySummary(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText)
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
        <div className={`status-pill ${tone}`}>{meetingStatusLabel(meeting.status.state)}</div>
      </div>
      <div className="meeting-row-summary">{artifactSummary(meeting)}</div>
    </button>
  )
}

function MeetingDetailMeta({ selectedMeeting, selectedStatus }: { selectedMeeting: MeetingDetail; selectedStatus: MeetingDetail['status'] }) {
  return (
    <div className="detail-meta-grid">
      <div className="detail-stat"><span>Started</span><strong>{dateLabel(selectedMeeting.startedAt)}</strong></div>
      <div className="detail-stat"><span>Meeting ID</span><strong>{selectedMeeting.id}</strong></div>
      <div className="detail-stat"><span>Capture</span><strong>{meetingStatusLabel(selectedStatus.capture.state)}</strong></div>
      <div className="detail-stat"><span>AI</span><strong>{processingStatusLabel(selectedStatus.processing.state)}</strong></div>
    </div>
  )
}

function MeetingFailureState({ message }: { message?: string }) {
  if (!message) return null
  return <div className="detail-surface detail-alert">{message}</div>
}

function MeetingPipeline({ selectedStatus }: { selectedStatus: MeetingDetail['status'] }) {
  return (
    <div className="diagnostic-section">
      <div className="meeting-section-label">Pipeline</div>
      <p>Capture {meetingStatusLabel(selectedStatus.capture.state)} · updated {dateLabel(selectedStatus.capture.updatedAt)}</p>
      <p>AI {processingStatusLabel(selectedStatus.processing.state)} · updated {dateLabel(selectedStatus.processing.updatedAt)}</p>
    </div>
  )
}

function MeetingArtifacts({ hasTranscript, hasSummary }: { hasTranscript: boolean; hasSummary: boolean }) {
  return (
    <div className="diagnostic-section">
      <div className="meeting-section-label">Artifacts</div>
      <div className="meeting-flags">
        <span className="meeting-tag">{artifactLabel(hasTranscript, 'Transcript ready', 'No transcript')}</span>
        <span className="meeting-tag">{artifactLabel(hasSummary, 'Summary ready', 'No summary')}</span>
      </div>
    </div>
  )
}

function MeetingDiagnostics({ selectedMeeting, hasTranscript, hasSummary }: { selectedMeeting: MeetingDetail; hasTranscript: boolean; hasSummary: boolean }) {
  return (
    <details className="detail-surface detail-block diagnostics-panel">
      <summary><span>Diagnostics</span><small>Metadata, pipeline, artifacts</small></summary>
      <MeetingDetailMeta selectedMeeting={selectedMeeting} selectedStatus={selectedMeeting.status} />
      <MeetingPipeline selectedStatus={selectedMeeting.status} />
      <MeetingArtifacts hasTranscript={hasTranscript} hasSummary={hasSummary} />
    </details>
  )
}

function MeetingsEmptyState({ onRecordFirst }: { onRecordFirst: () => void }) {
  return (
    <div className="empty-state meetings-empty">
      <strong>No meetings yet.</strong>
      <span>Record first meeting to create summary and transcript.</span>
      <button className="primary" onClick={onRecordFirst}>Record first meeting</button>
    </div>
  )
}

function MeetingsListPanel({ meetings, selectedMeetingId, onRefresh, onSelectMeeting, onRecordFirst }: Pick<MeetingsViewProps, 'meetings' | 'selectedMeetingId' | 'onRefresh' | 'onSelectMeeting' | 'onRecordFirst'>) {
  return (
    <section className="panel list-panel">
      <div className="panel-header compact">
        <div><h1>Meetings</h1><p>{meetings.length} saved sessions</p></div>
        <button className="secondary" onClick={onRefresh}>Refresh</button>
      </div>
      <div className="meeting-list">
        {meetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} selected={meeting.id === selectedMeetingId} onSelect={onSelectMeeting} />)}
        {meetings.length === 0 ? <MeetingsEmptyState onRecordFirst={onRecordFirst} /> : null}
      </div>
    </section>
  )
}

function SummaryCopyButton({ summary }: { summary: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => setCopyState('idle'), [summary])
  if (!summary || !canCopySummary()) return null
  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return <button className="secondary compact-action" onClick={() => void copySummary()}>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy summary'}</button>
}

function ReadingCard({ title, value, emptyText, primary }: { title: string; value: string; emptyText: string; primary?: boolean }) {
  return (
    <div className={primary ? 'detail-surface detail-block reading-card primary-reading-card' : 'detail-surface detail-block reading-card'}>
      <div className="reading-card-header">
        <div className="meeting-section-label">{title}</div>
        {primary ? <SummaryCopyButton summary={value} /> : null}
      </div>
      <div className="reading-text">{value || emptyText}</div>
    </div>
  )
}

function DetailShell({ children }: { children: ReactNode }) {
  return <section className="panel detail-panel"><div className="detail-reading-stack">{children}</div></section>
}

function MeetingDetailPanel(props: Pick<MeetingsViewProps, 'selectedMeetingId' | 'selectedMeeting' | 'selectedMeetingLoading' | 'selectedMeetingError' | 'transcript' | 'onRefresh'>) {
  const { selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onRefresh } = props
  if (selectedMeetingLoading) return <DetailShell><div className="empty-state">Loading meeting…</div></DetailShell>
  if (selectedMeetingError) return <DetailShell><div className="detail-surface detail-alert">{selectedMeetingError}</div></DetailShell>
  if (!selectedMeetingId || !selectedMeeting) return <DetailShell><div className="empty-state">Select a meeting to view details.</div></DetailShell>
  return <SelectedMeetingDetail selectedMeeting={selectedMeeting} transcript={transcript} onRefresh={onRefresh} />
}

function SelectedMeetingDetail({ selectedMeeting, transcript, onRefresh }: { selectedMeeting: MeetingDetail; transcript: string; onRefresh: () => void }) {
  const hasTranscript = Boolean(transcript)
  const hasSummary = Boolean(selectedMeeting.summary)
  return (
    <section className="panel detail-panel">
      <div className="panel-header">
        <div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1><p className="meeting-detail-summary">Read summary first. Transcript follows for full context.</p></div>
        <button className="secondary" onClick={onRefresh}>Refresh</button>
      </div>
      <div className="detail-grid detail-reading-stack">
        <ReadingCard title="AI summary" value={selectedMeeting.summary ?? ''} emptyText="No AI summary yet." primary />
        <ReadingCard title="Transcript" value={transcript} emptyText="No transcript yet." />
        <MeetingFailureState message={selectedMeeting.status.capture.failureMessage} />
        <MeetingFailureState message={selectedMeeting.status.processing.failureMessage} />
        <MeetingDiagnostics selectedMeeting={selectedMeeting} hasTranscript={hasTranscript} hasSummary={hasSummary} />
      </div>
    </section>
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
