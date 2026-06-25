import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import './meeting-detail.css'
import './meeting-reading.css'
import { meetingStatusLabel, meetingStatusPillVisible, meetingStatusTone } from '../components/meeting-status'
import { Markdown } from '../components/markdown'
import { Button, EmptyState, Panel, StatusPill } from '../components/ui'
import { TranscriptText } from './transcript-view'

const EXPAND_READING_LABEL = 'More'
const COLLAPSE_READING_LABEL = 'Less'
const PROCESSING_STATUS = 'processing'
const RECORDING_STATE = 'recording'
const CAPTURED_STATE = 'captured'
const SUMMARY_TAB = 'summary'
const TRANSCRIPT_TAB = 'transcript'
type DetailTab = typeof SUMMARY_TAB | typeof TRANSCRIPT_TAB
type MeetingDetailPanelProps = {
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
  onDeleteMeeting: (id: string) => Promise<void>
}

function canCopySummary(): boolean { return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText) }

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

function ReadingCard({ title, value, emptyText, primary, markdown, defaultExpanded = false, resetKey = value, children }: { title: string; value: string; emptyText: string; primary?: boolean; markdown?: boolean; defaultExpanded?: boolean; resetKey?: string; children?: ReactNode }) {
  const reading = useReadingExpansion(value, defaultExpanded, resetKey)
  const className = primary ? 'detail-surface detail-block reading-card primary-reading-card' : 'detail-surface detail-block reading-card'
  const textClassName = reading.expanded ? 'reading-text reading-expanded' : 'reading-text reading-preview'
  const body = value ? (children ?? (markdown ? <Markdown value={value} /> : value)) : emptyText
  return (
    <div className={className}>
      <div className="reading-card-header"><div className="meeting-section-label">{title}</div><ReadingActions primary={primary} value={value} expanded={reading.expanded} expandable={reading.expandable} onToggle={() => reading.setExpanded((current) => !current)} /></div>
      <div ref={reading.ref} className={textClassName}>{body}</div>
    </div>
  )
}

function useReadingExpansion(value: string, defaultExpanded: boolean, resetKey: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => setExpanded(defaultExpanded), [resetKey, defaultExpanded])
  useLayoutEffect(() => observeOverflow(ref.current, value, setOverflowing), [value, expanded])
  return { ref, expanded, setExpanded, expandable: expanded || overflowing }
}

function observeOverflow(element: HTMLDivElement | null, value: string, setOverflowing: (value: boolean) => void) {
  if (!element || !value) return setOverflowing(false)
  const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
  measure()
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  return () => observer.disconnect()
}

function DetailShell({ children }: { children: ReactNode }) { return <Panel className="detail-panel"><div className="detail-reading-stack">{children}</div></Panel> }

function MeetingFailureState({ message }: { message?: string }) { return message ? <div className="detail-surface detail-alert">{message}</div> : null }

function meetingIsProcessing(meeting: MeetingDetail): boolean { return meeting.status.state === RECORDING_STATE || meeting.status.processing.state === PROCESSING_STATUS }

function DetailTabs({ activeTab, onChange }: { activeTab: DetailTab; onChange: (tab: DetailTab) => void }) {
  return (
    <div className="detail-tabs" role="tablist" aria-label="Meeting detail sections">
      <button className={tabClassName(activeTab, SUMMARY_TAB)} onClick={() => onChange(SUMMARY_TAB)} role="tab" aria-selected={activeTab === SUMMARY_TAB}>Summary</button>
      <button className={tabClassName(activeTab, TRANSCRIPT_TAB)} onClick={() => onChange(TRANSCRIPT_TAB)} role="tab" aria-selected={activeTab === TRANSCRIPT_TAB}>Transcript</button>
    </div>
  )
}

function tabClassName(activeTab: DetailTab, tab: DetailTab): string { return activeTab === tab ? 'detail-tab active' : 'detail-tab' }

function MeetingDeleteButton({ meeting, onDeleteMeeting }: { meeting: MeetingDetail; onDeleteMeeting: (id: string) => Promise<void> }) {
  const [deleting, setDeleting] = useState(false)
  const disabled = deleting || !meetingDeleteAllowed(meeting)
  async function handleDelete() {
    if (!confirmMeetingDelete(meeting)) return
    setDeleting(true)
    try {
      await onDeleteMeeting(meeting.id)
    } finally {
      setDeleting(false)
    }
  }
  return <Button className="compact-action danger-action" disabled={disabled} title={disabled ? deleteDisabledLabel(meeting) : undefined} onClick={() => void handleDelete()}>{deleting ? 'Deleting…' : 'Delete'}</Button>
}

function meetingDeleteAllowed(meeting: MeetingDetail): boolean { return meeting.status.state !== RECORDING_STATE && meeting.status.processing.state !== PROCESSING_STATUS }

function deleteDisabledLabel(meeting: MeetingDetail): string {
  if (meeting.status.state === RECORDING_STATE) return 'Stop recording before deleting.'
  if (meeting.status.processing.state === PROCESSING_STATUS) return 'Wait for processing to finish before deleting.'
  return ''
}

function confirmMeetingDelete(meeting: MeetingDetail): boolean {
  const title = meeting.title || 'this meeting'
  return window.confirm(`Delete “${title}”?\n\nThis removes summary, transcript, segments, and audio files.`)
}

function SelectedMeetingDetail({ selectedMeeting, transcript, onDeleteMeeting }: { selectedMeeting: MeetingDetail; transcript: string; onDeleteMeeting: (id: string) => Promise<void> }) {
  const hasTranscript = Boolean(transcript)
  const [activeTab, setActiveTab] = useState<DetailTab>(SUMMARY_TAB)
  useEffect(() => setActiveTab(SUMMARY_TAB), [selectedMeeting.id])
  return (
    <Panel className="detail-panel readable-detail-panel">
      <div className="panel-header compact meeting-detail-header">
        <div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1><p>{detailSubtitle(selectedMeeting, hasTranscript)}</p></div>
        <div className="meeting-detail-actions">{meetingStatusPillVisible(selectedMeeting.status.state) ? <StatusPill tone={meetingStatusTone(selectedMeeting.status.state)}>{meetingStatusLabel(selectedMeeting.status.state)}</StatusPill> : null}<MeetingDeleteButton meeting={selectedMeeting} onDeleteMeeting={onDeleteMeeting} /></div>
      </div>
      <DetailTabs activeTab={activeTab} onChange={(tab) => setActiveTab(tab)} />
      <DetailBody activeTab={activeTab} selectedMeeting={selectedMeeting} transcript={transcript} hasTranscript={hasTranscript} />
    </Panel>
  )
}

function DetailBody({ activeTab, selectedMeeting, transcript, hasTranscript }: { activeTab: DetailTab; selectedMeeting: MeetingDetail; transcript: string; hasTranscript: boolean }) {
  const recording = selectedMeeting.status.state === RECORDING_STATE
  return (
    <div className="detail-grid detail-reading-stack">
      <MeetingFailureState message={selectedMeeting.status.capture.failureMessage} />
      <MeetingFailureState message={selectedMeeting.status.processing.failureMessage} />
      <div className="detail-tab-body">
        {activeTab === SUMMARY_TAB ? <ReadingCard title="Summary" value={selectedMeeting.summary ?? ''} emptyText={summaryEmptyText(selectedMeeting, hasTranscript)} resetKey={selectedMeeting.id} primary markdown /> : null}
        {activeTab === TRANSCRIPT_TAB && recording ? <TrackingIndicator /> : null}
        {activeTab === TRANSCRIPT_TAB && !recording ? <ReadingCard title="Transcript" value={transcript} emptyText={transcriptEmptyText(selectedMeeting)} resetKey={selectedMeeting.id}><TranscriptText value={transcript} segments={selectedMeeting.segments ?? []} /></ReadingCard> : null}
      </div>
    </div>
  )
}

function TrackingIndicator() { return <div className="detail-surface detail-block"><div className="meeting-section-label">Tracking</div><p>Recording audio. Transcript appears after meeting ends.</p></div> }

function detailSubtitle(meeting: MeetingDetail, hasTranscript: boolean): string {
  if (meeting.status.state === RECORDING_STATE) return 'Recording audio · transcript after stop.'
  if (meetingIsProcessing(meeting) && hasTranscript) return 'Transcript ready · summary running.'
  if (meetingIsProcessing(meeting)) return 'Transcribing audio.'
  if (hasTranscript) return 'Transcript ready.'
  if (meeting.status.state === CAPTURED_STATE) return 'Audio captured.'
  return 'Analysis and transcript for selected meeting.'
}

function summaryEmptyText(meeting: MeetingDetail, hasTranscript: boolean): string {
  if (meetingIsProcessing(meeting)) return 'Summary appears when local AI finishes.'
  if (hasTranscript) return 'Transcript ready. Summary not generated yet.'
  return 'Summary appears after recording is processed.'
}

function transcriptEmptyText(meeting: MeetingDetail): string {
  if (meetingIsProcessing(meeting)) return 'Transcribing audio…'
  return 'No transcript yet.'
}

export function MeetingDetailPanel(props: MeetingDetailPanelProps) {
  const { selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript, onDeleteMeeting } = props
  if (selectedMeetingLoading) return <DetailShell><EmptyState>Loading meeting…</EmptyState></DetailShell>
  if (selectedMeetingError) return <DetailShell><div className="detail-surface detail-alert">{selectedMeetingError}</div></DetailShell>
  if (!selectedMeetingId || !selectedMeeting) return <DetailShell><EmptyState>Select a meeting to view details.</EmptyState></DetailShell>
  return <SelectedMeetingDetail selectedMeeting={selectedMeeting} transcript={transcript} onDeleteMeeting={onDeleteMeeting} />
}
