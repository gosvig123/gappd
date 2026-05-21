import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import './meeting-detail.css'
import { artifactLabel, meetingStatusLabel, processingStatusLabel } from '../components/meeting-status'
import { Button, EmptyState, Panel } from '../components/ui'

const READING_COLLAPSE_RATIO = 0.4
const READING_OVERFLOW_PADDING = 1
const READING_MORE_LABEL = 'Read more'
const READING_LESS_LABEL = 'Show less'

type MeetingDetailPanelProps = {
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
  onRefresh: () => void
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
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

function useReadingOverflow(value: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => setExpanded(false), [value])
  useEffect(() => {
    const target = ref.current
    if (!target || typeof window === 'undefined') return undefined
    const update = () => setOverflowing(target.scrollHeight > window.innerHeight * READING_COLLAPSE_RATIO + READING_OVERFLOW_PADDING)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    update()
    observer?.observe(target)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [value])
  return { expanded, overflowing, ref, setExpanded }
}

function ReadingCard({ title, value, emptyText, primary }: { title: string; value: string; emptyText: string; primary?: boolean }) {
  const { expanded, overflowing, ref, setExpanded } = useReadingOverflow(value)
  const className = primary ? 'detail-surface detail-block reading-card primary-reading-card' : 'detail-surface detail-block reading-card'
  const textClassName = overflowing && !expanded ? 'reading-text collapsed' : 'reading-text'
  return (
    <div className={className}>
      <div className="reading-card-header">
        <div className="meeting-section-label">{title}</div>
        {primary ? <SummaryCopyButton summary={value} /> : null}
      </div>
      <div ref={ref} className={textClassName}>{value || emptyText}</div>
      {overflowing ? <Button className="compact-action reading-toggle" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? READING_LESS_LABEL : READING_MORE_LABEL}</Button> : null}
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
    <details className="detail-surface detail-block diagnostics-panel">
      <summary><span>Diagnostics</span><small>Metadata, pipeline, artifacts</small></summary>
      <MeetingDetailMeta selectedMeeting={selectedMeeting} />
      <div className="diagnostic-section">
        <div className="meeting-section-label">Pipeline</div>
        <p>Capture {meetingStatusLabel(selectedMeeting.status.capture.state)} · updated {dateLabel(selectedMeeting.status.capture.updatedAt)}</p>
        <p>AI {processingStatusLabel(selectedMeeting.status.processing.state)} · updated {dateLabel(selectedMeeting.status.processing.updatedAt)}</p>
      </div>
      <div className="diagnostic-section">
        <div className="meeting-section-label">Artifacts</div>
        <div className="meeting-flags">
          <span className="meeting-tag">{artifactLabel(hasTranscript, 'Transcript ready', 'No transcript')}</span>
          <span className="meeting-tag">{artifactLabel(hasSummary, 'Summary ready', 'No summary')}</span>
        </div>
      </div>
    </details>
  )
}

function SelectedMeetingDetail({ selectedMeeting, transcript, onRefresh }: { selectedMeeting: MeetingDetail; transcript: string; onRefresh: () => void }) {
  const hasTranscript = Boolean(transcript)
  const hasSummary = Boolean(selectedMeeting.summary)
  return (
    <Panel className="detail-panel">
      <div className="panel-header">
        <div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1><p className="meeting-detail-summary">Read summary first. Transcript follows for full context.</p></div>
        <Button onClick={onRefresh}>Refresh</Button>
      </div>
      <div className="detail-grid detail-reading-stack">
        <ReadingCard title="AI summary" value={selectedMeeting.summary ?? ''} emptyText="No AI summary yet." primary />
        <ReadingCard title="Transcript" value={transcript} emptyText="No transcript yet." />
        <MeetingFailureState message={selectedMeeting.status.capture.failureMessage} />
        <MeetingFailureState message={selectedMeeting.status.processing.failureMessage} />
        <MeetingDiagnostics selectedMeeting={selectedMeeting} hasTranscript={hasTranscript} hasSummary={hasSummary} />
      </div>
    </Panel>
  )
}

export function MeetingDetailPanel(props: MeetingDetailPanelProps) {
  const { selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onRefresh } = props
  if (selectedMeetingLoading) return <DetailShell><EmptyState>Loading meeting…</EmptyState></DetailShell>
  if (selectedMeetingError) return <DetailShell><div className="detail-surface detail-alert">{selectedMeetingError}</div></DetailShell>
  if (!selectedMeetingId || !selectedMeeting) return <DetailShell><EmptyState>Select a meeting to view details.</EmptyState></DetailShell>
  return <SelectedMeetingDetail selectedMeeting={selectedMeeting} transcript={transcript} onRefresh={onRefresh} />
}
