import { type ReactNode, useEffect, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import './meeting-detail.css'
import { artifactLabel, meetingStatusLabel, meetingStatusTone, processingStatusLabel } from '../components/meeting-status'
import { Markdown } from '../components/markdown'
import { Button, EmptyState, Panel, StatusPill } from '../components/ui'
import { dateLabel } from './today-model'

const EXPAND_READING_LABEL = 'Expand'
const COLLAPSE_READING_LABEL = 'Collapse'
const PROCESSING_STATUS = 'processing'
const RECORDING_STATE = 'recording'
const CAPTURED_STATE = 'captured'
const SHOW_DIAGNOSTICS = import.meta.env.DEV

type MeetingDetailPanelProps = {
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
}

function canCopySummary(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText)
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
  return <Button className="compact-action" onClick={() => void copySummary()}>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy summary'}</Button>
}

function ReadingActions({ primary, value, expanded, onToggle }: { primary?: boolean; value: string; expanded: boolean; onToggle: () => void }) {
  if (!primary && !value) return null
  return (
    <div className="reading-card-actions">
      {primary ? <SummaryCopyButton summary={value} /> : null}
      {value ? <Button className="compact-action reading-toggle" onClick={onToggle} aria-expanded={expanded}>{expanded ? COLLAPSE_READING_LABEL : EXPAND_READING_LABEL}</Button> : null}
    </div>
  )
}

function ReadingCard({ title, value, emptyText, primary, markdown }: { title: string; value: string; emptyText: string; primary?: boolean; markdown?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const className = primary ? 'detail-surface detail-block reading-card primary-reading-card' : 'detail-surface detail-block reading-card'
  const textClassName = expanded ? 'reading-text' : 'reading-text reading-preview'
  useEffect(() => setExpanded(false), [value])
  return (
    <div className={className}>
      <div className="reading-card-header"><div className="meeting-section-label">{title}</div><ReadingActions primary={primary} value={value} expanded={expanded} onToggle={() => setExpanded((current) => !current)} /></div>
      <div className={textClassName}>{value ? (markdown ? <Markdown value={value} /> : value) : emptyText}</div>
    </div>
  )
}

function DetailShell({ children }: { children: ReactNode }) {
  return <Panel className="detail-panel"><div className="detail-reading-stack">{children}</div></Panel>
}

function MeetingFailureState({ message }: { message?: string }) {
  if (!message) return null
  return <div className="detail-surface detail-alert">{message}</div>
}

function meetingIsProcessing(meeting: MeetingDetail): boolean {
  return meeting.status.state === RECORDING_STATE || meeting.status.processing.state === PROCESSING_STATUS
}

function ProcessingProgress({ meeting, hasTranscript }: { meeting: MeetingDetail; hasTranscript: boolean }) {
  if (!meetingIsProcessing(meeting)) return null
  return (
    <div className="detail-surface processing-progress">
      <div><div className="meeting-section-label">{processingLabel(meeting)}</div><p>{processingDetail(meeting, hasTranscript)}</p></div>
      <ProcessingSteps meeting={meeting} hasTranscript={hasTranscript} />
    </div>
  )
}

function processingLabel(meeting: MeetingDetail): string {
  return meeting.status.state === RECORDING_STATE ? 'Conversation recording' : 'Conversation processing'
}

function processingDetail(meeting: MeetingDetail, hasTranscript: boolean): string {
  if (meeting.status.state === RECORDING_STATE) return 'Recording now. Live transcript draft updates every few seconds.'
  if (hasTranscript) return 'Transcript saved. AI summary is still running.'
  return 'Audio captured. Transcribing and creating AI summary now.'
}

function ProcessingSteps({ meeting, hasTranscript }: { meeting: MeetingDetail; hasTranscript: boolean }) {
  const recording = meeting.status.state === RECORDING_STATE
  const processing = meeting.status.processing.state === PROCESSING_STATUS
  return (
    <ol className="processing-steps">
      <ProcessingStep active={recording} done={!recording}>Recording audio</ProcessingStep>
      <ProcessingStep done={!recording}>Audio captured</ProcessingStep>
      <ProcessingStep active={(recording || processing) && !hasTranscript} done={hasTranscript}>Transcript draft</ProcessingStep>
      <ProcessingStep active={processing && hasTranscript}>Creating AI summary</ProcessingStep>
    </ol>
  )
}

function ProcessingStep({ children, active, done }: { children: ReactNode; active?: boolean; done?: boolean }) {
  const className = done ? 'done' : active ? 'active' : undefined
  return <li className={className}>{children}</li>
}

function MeetingDetailMeta({ selectedMeeting }: { selectedMeeting: MeetingDetail }) {
  return (
    <div className="detail-meta-grid">
      <div className="detail-stat"><span>Started</span><strong>{dateLabel(selectedMeeting.startedAt)}</strong></div>
      <div className="detail-stat"><span>Meeting ID</span><strong>{selectedMeeting.id}</strong></div>
      <div className="detail-stat"><span>Capture</span><strong>{meetingStatusLabel(selectedMeeting.status.capture.state)}</strong></div>
      <div className="detail-stat"><span>AI</span><strong>{processingStatusLabel(selectedMeeting.status.processing.state)}</strong></div>
    </div>
  )
}

function MeetingDiagnostics({ selectedMeeting, hasTranscript, hasSummary }: { selectedMeeting: MeetingDetail; hasTranscript: boolean; hasSummary: boolean }) {
  return (
    <details className="detail-surface detail-block">
      <summary><span>Diagnostics</span><small>Metadata, pipeline, artifacts</small></summary>
      <MeetingDetailMeta selectedMeeting={selectedMeeting} />
      <div className="detail-block">
        <div className="meeting-section-label">Pipeline</div>
        <p>Capture {meetingStatusLabel(selectedMeeting.status.capture.state)} · updated {dateLabel(selectedMeeting.status.capture.updatedAt)}</p>
        <p>AI {processingStatusLabel(selectedMeeting.status.processing.state)} · updated {dateLabel(selectedMeeting.status.processing.updatedAt)}</p>
      </div>
      <div className="detail-block">
        <div className="meeting-section-label">Artifacts</div>
        <div className="meeting-flags">
          <span className="meeting-tag">{artifactLabel(hasTranscript, 'Transcript ready', 'No transcript')}</span>
          <span className="meeting-tag">{artifactLabel(hasSummary, 'Summary ready', 'No summary')}</span>
        </div>
      </div>
    </details>
  )
}

function SelectedMeetingDetail({ selectedMeeting, transcript }: { selectedMeeting: MeetingDetail; transcript: string }) {
  const hasTranscript = Boolean(transcript)
  const hasSummary = Boolean(selectedMeeting.summary)
  const processing = meetingIsProcessing(selectedMeeting)
  return (
    <Panel className="detail-panel">
      <div className="panel-header compact meeting-detail-header">
        <div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1><p>{detailSubtitle(selectedMeeting, hasTranscript, hasSummary)}</p></div>
        <StatusPill tone={meetingStatusTone(selectedMeeting.status.state)}>{meetingStatusLabel(selectedMeeting.status.state)}</StatusPill>
      </div>
      <div className="detail-grid detail-reading-stack">
        <MeetingFailureState message={selectedMeeting.status.capture.failureMessage} />
        <MeetingFailureState message={selectedMeeting.status.processing.failureMessage} />
        <ProcessingProgress meeting={selectedMeeting} hasTranscript={hasTranscript} />
        <ReadingCard title="AI summary" value={selectedMeeting.summary ?? ''} emptyText={summaryEmptyText(processing)} primary markdown />
        <ReadingCard title="Transcript" value={transcript} emptyText={transcriptEmptyText(processing)} />
        {SHOW_DIAGNOSTICS ? <MeetingDiagnostics selectedMeeting={selectedMeeting} hasTranscript={hasTranscript} hasSummary={hasSummary} /> : null}
      </div>
    </Panel>
  )
}

function detailSubtitle(meeting: MeetingDetail, hasTranscript: boolean, hasSummary: boolean): string {
  if (meeting.status.state === RECORDING_STATE) return 'Recording with live transcript draft.'
  if (meetingIsProcessing(meeting)) return 'Processing transcript and AI summary.'
  if (hasSummary || hasTranscript) return 'Ready to review.'
  if (meeting.status.state === CAPTURED_STATE) return 'Audio captured. Processing has not started.'
  return 'Analysis and transcript for selected meeting.'
}

function summaryEmptyText(processing: boolean): string {
  return processing ? 'Summary appears after transcript processing finishes.' : 'No AI summary yet.'
}

function transcriptEmptyText(processing: boolean): string {
  return processing ? 'Transcript is being prepared from captured audio.' : 'No transcript yet.'
}

export function MeetingDetailPanel(props: MeetingDetailPanelProps) {
  const { selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript } = props
  if (selectedMeetingLoading) return <DetailShell><EmptyState>Loading meeting…</EmptyState></DetailShell>
  if (selectedMeetingError) return <DetailShell><div className="detail-surface detail-alert">{selectedMeetingError}</div></DetailShell>
  if (!selectedMeetingId || !selectedMeeting) return <DetailShell><EmptyState>Select a meeting to view details.</EmptyState></DetailShell>
  return <SelectedMeetingDetail selectedMeeting={selectedMeeting} transcript={transcript} />
}
