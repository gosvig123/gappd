import { type ReactNode, useEffect, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import './meeting-detail.css'
import './meeting-reading.css'
import { artifactLabel, meetingStatusLabel, meetingStatusTone, processingStatusLabel } from '../components/meeting-status'
import { Markdown } from '../components/markdown'
import { Button, EmptyState, Panel, StatusPill } from '../components/ui'
import { dateLabel } from './today-model'
import { TranscriptText } from './transcript-view'

const EXPAND_READING_LABEL = 'More'
const COLLAPSE_READING_LABEL = 'Less'
const PREVIEW_CHARACTER_LIMIT = 700
const PREVIEW_LINE_LIMIT = 8
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

function ReadingActions({ primary, value, expanded, expandable, onToggle }: { primary?: boolean; value: string; expanded: boolean; expandable: boolean; onToggle: () => void }) {
  if (!primary && !expandable) return null
  return (
    <div className="reading-card-actions">
      {primary ? <SummaryCopyButton summary={value} /> : null}
      {expandable ? <Button className="compact-action reading-toggle" onClick={onToggle} aria-expanded={expanded}>{expanded ? COLLAPSE_READING_LABEL : EXPAND_READING_LABEL}</Button> : null}
    </div>
  )
}

function canExpandReading(value: string): boolean {
  return value.length > PREVIEW_CHARACTER_LIMIT || value.split('\n').length > PREVIEW_LINE_LIMIT
}

function ReadingCard({ title, value, emptyText, primary, markdown, defaultExpanded = false, resetKey = value, children }: { title: string; value: string; emptyText: string; primary?: boolean; markdown?: boolean; defaultExpanded?: boolean; resetKey?: string; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const expandable = canExpandReading(value)
  const className = primary ? 'detail-surface detail-block reading-card primary-reading-card' : 'detail-surface detail-block reading-card'
  const textClassName = expanded || !expandable ? 'reading-text' : 'reading-text reading-preview'
  const body = value ? (children ?? (markdown ? <Markdown value={value} /> : value)) : emptyText
  useEffect(() => setExpanded(defaultExpanded), [resetKey, defaultExpanded])
  return (
    <div className={className}>
      <div className="reading-card-header"><div className="meeting-section-label">{title}</div><ReadingActions primary={primary} value={value} expanded={expanded} expandable={expandable} onToggle={() => setExpanded((current) => !current)} /></div>
      <div className={textClassName}>{body}</div>
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
  const recording = selectedMeeting.status.state === RECORDING_STATE
  return (
    <Panel className="detail-panel">
      <div className="panel-header compact meeting-detail-header">
        <div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1><p>{detailSubtitle(selectedMeeting, hasTranscript, hasSummary)}</p></div>
        <StatusPill tone={meetingStatusTone(selectedMeeting.status.state)}>{meetingStatusLabel(selectedMeeting.status.state)}</StatusPill>
      </div>
      <div className="detail-grid detail-reading-stack">
        <MeetingFailureState message={selectedMeeting.status.capture.failureMessage} />
        <MeetingFailureState message={selectedMeeting.status.processing.failureMessage} />
        {hasSummary ? <ReadingCard title="Summary" value={selectedMeeting.summary ?? ''} emptyText="" resetKey={selectedMeeting.id} primary markdown /> : null}
        {recording ? <TrackingIndicator /> : <ReadingCard title="Transcript" value={transcript} emptyText={transcriptEmptyText(selectedMeeting)} resetKey={selectedMeeting.id}><TranscriptText value={transcript} segments={selectedMeeting.segments ?? []} /></ReadingCard>}
        {SHOW_DIAGNOSTICS ? <MeetingDiagnostics selectedMeeting={selectedMeeting} hasTranscript={hasTranscript} hasSummary={hasSummary} /> : null}
      </div>
    </Panel>
  )
}

function TrackingIndicator() {
  return <div className="detail-surface detail-block"><div className="meeting-section-label">Tracking</div><p>Recording audio. Transcript appears after meeting ends.</p></div>
}

function detailSubtitle(meeting: MeetingDetail, hasTranscript: boolean, hasSummary: boolean): string {
  if (meeting.status.state === RECORDING_STATE) return 'Recording audio · transcript after stop.'
  if (meetingIsProcessing(meeting) && hasTranscript) return 'Transcript ready · summary running.'
  if (meetingIsProcessing(meeting)) return 'Transcribing audio.'
  if (hasSummary) return 'Summary ready.'
  if (hasTranscript) return 'Transcript ready.'
  if (meeting.status.state === CAPTURED_STATE) return 'Audio captured.'
  return 'Analysis and transcript for selected meeting.'
}

function transcriptEmptyText(meeting: MeetingDetail): string {
  if (meetingIsProcessing(meeting)) return 'Transcribing audio…'
  return 'No transcript yet.'
}

export function MeetingDetailPanel(props: MeetingDetailPanelProps) {
  const { selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript } = props
  if (selectedMeetingLoading) return <DetailShell><EmptyState>Loading meeting…</EmptyState></DetailShell>
  if (selectedMeetingError) return <DetailShell><div className="detail-surface detail-alert">{selectedMeetingError}</div></DetailShell>
  if (!selectedMeetingId || !selectedMeeting) return <DetailShell><EmptyState>Select a meeting to view details.</EmptyState></DetailShell>
  return <SelectedMeetingDetail selectedMeeting={selectedMeeting} transcript={transcript} />
}
