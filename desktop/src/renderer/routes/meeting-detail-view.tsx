import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../shared/meeting-recording-workflow'
import './meeting-detail.css'
import './meeting-reading.css'
import { Markdown } from '../components/markdown'
import { meetingFailed, meetingHasWork, meetingProgressLabel, PostMeetingProgressCard, type MeetingProgressInput } from '../components/meeting-progress'
import { Button, EmptyState, Panel, StatusPill } from '../components/ui'
import { AlignLeftIcon, CopyIcon, FileTextIcon } from '../components/icons'
import { TranscriptText } from './transcript-view'

const PROCESSING_STATUS = 'processing', RECORDING_STATE = 'recording', PENDING_STATE = 'pending', DEGRADED_STATE = 'degraded'
const SUMMARY_TAB = 'summary', TRANSCRIPT_TAB = 'transcript'
type DetailTab = typeof SUMMARY_TAB | typeof TRANSCRIPT_TAB
type MeetingSegment = MeetingDetail['segments'][number]
type MeetingDetailPanelProps = { selectedMeetingId: string | null; selectedMeeting: MeetingDetail | null; selectedMeetingLoading: boolean; selectedMeetingError: string | null; transcript: string }

function canCopyArtifact(): boolean { return typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText) }

function CopyArtifactButton({ value, label }: { value: string; label: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => setCopyState('idle'), [value, label])
  if (!value || !canCopyArtifact()) return null
  async function copyArtifact() {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return <Button className="compact-action detail-action" aria-label={copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : label} onClick={() => void copyArtifact()}><CopyIcon aria-hidden="true" /> <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : label}</span></Button>
}

function useReadingOverflow(value: string, resetKey: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => observeOverflow(ref.current, value, setOverflowing), [value, resetKey])
  return { ref, overflowing }
}

function observeOverflow(element: HTMLDivElement | null, value: string, setOverflowing: (value: boolean) => void) {
  if (!element || !value) return setOverflowing(false)
  const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
  measure()
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  return () => observer.disconnect()
}

function ReadingActions({ value, copyLabel }: { value: string; copyLabel: string }) {
  if (!value || !canCopyArtifact()) return null
  return <div className="reading-card-actions"><CopyArtifactButton value={value} label={copyLabel} /></div>
}

function ReadingCard({ value, emptyText, markdown, reading, children }: { value: string; emptyText: string; markdown?: boolean; reading: ReturnType<typeof useReadingOverflow>; children?: ReactNode }) {
  const cardClassName = markdown ? 'detail-block reading-card markdown-reading-card' : 'detail-block reading-card'
  const className = reading.overflowing ? `${cardClassName} reading-card-overflow` : cardClassName
  const body = value ? (children ?? (markdown ? <Markdown value={value} /> : value)) : emptyText
  return <div className={className}><div ref={reading.ref} className="reading-text">{body}</div></div>
}

function DetailShell({ children }: { children: ReactNode }) { return <Panel className="detail-panel"><div className="detail-reading-stack">{children}</div></Panel> }

function MeetingFailureState({ message }: { message?: string }) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)
  if (!message || dismissedMessage === message) return null
  return <div className="detail-surface detail-alert dismissible-note"><span>{message}</span><button className="icon-dismiss" type="button" aria-label="Dismiss error" onClick={() => setDismissedMessage(message)}>×</button></div>
}

function meetingIsProcessing(meeting: MeetingDetail): boolean { return meeting.status.state === RECORDING_STATE || meeting.status.processing.state === PROCESSING_STATUS }

function DetailTabs({ activeTab, onChange, actions }: { activeTab: DetailTab; onChange: (tab: DetailTab) => void; actions?: ReactNode }) {
  return (
    <div className="detail-tabs-row">
      <div className="detail-tabs" role="tablist" aria-label="Meeting detail sections">
        <button className={tabClassName(activeTab, SUMMARY_TAB)} onClick={() => onChange(SUMMARY_TAB)} role="tab" aria-selected={activeTab === SUMMARY_TAB}><AlignLeftIcon aria-hidden="true" /> <span>Summary</span></button>
        <button className={tabClassName(activeTab, TRANSCRIPT_TAB)} onClick={() => onChange(TRANSCRIPT_TAB)} role="tab" aria-selected={activeTab === TRANSCRIPT_TAB}><FileTextIcon aria-hidden="true" /> <span>Transcript</span></button>
      </div>
      {actions}
    </div>
  )
}

function tabClassName(activeTab: DetailTab, tab: DetailTab): string { return activeTab === tab ? 'detail-tab active' : 'detail-tab' }

function SelectedMeetingDetail({ selectedMeeting, transcript }: { selectedMeeting: MeetingDetail; transcript: string }) {
  const detailTranscriptText = detailTranscript(selectedMeeting, transcript)
  const hasTranscript = Boolean(detailTranscriptText)
  const progress = detailProgressInput(selectedMeeting, hasTranscript)
  const subtitle = detailSubtitle(selectedMeeting, progress)
  const [activeTab, setActiveTab] = useState<DetailTab>(SUMMARY_TAB)
  useEffect(() => setActiveTab(SUMMARY_TAB), [selectedMeeting.id])
  return (
    <Panel className="detail-panel readable-detail-panel">
      <div className="panel-header compact meeting-detail-header">
        <div className="meeting-detail-title"><h1>{selectedMeeting.title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
        <div className="meeting-detail-actions">{meetingStatusPillVisible(selectedMeeting.status.state) ? <StatusPill tone={meetingStatusTone(selectedMeeting.status.state)}>{meetingProgressLabel(progress)}</StatusPill> : null}</div>
      </div>
      <DetailBody activeTab={activeTab} onTabChange={setActiveTab} selectedMeeting={selectedMeeting} transcript={detailTranscriptText} hasTranscript={hasTranscript} />
    </Panel>
  )
}

function DetailBody({ activeTab, onTabChange, selectedMeeting, transcript, hasTranscript }: { activeTab: DetailTab; onTabChange: (tab: DetailTab) => void; selectedMeeting: MeetingDetail; transcript: string; hasTranscript: boolean }) {
  const recording = selectedMeeting.status.state === RECORDING_STATE
  const copyValue = tabCopyValue(activeTab, selectedMeeting, transcript)
  const reading = useReadingOverflow(copyValue, `${selectedMeeting.id}:${activeTab}`)
  const actions = <ReadingActions value={copyValue} copyLabel={tabCopyLabel(activeTab)} />
  return (
    <div className="detail-grid detail-reading-stack">
      <MeetingFailureState message={selectedMeeting.status.capture.failureMessage} />
      <MeetingFailureState message={selectedMeeting.status.processing.failureMessage} />
      <DiarizationNotice meeting={selectedMeeting} />
      <DetailTabs activeTab={activeTab} onChange={onTabChange} actions={actions} />
      <div className="detail-tab-body" key={activeTab}>
        {activeTab === SUMMARY_TAB ? <SummaryPanel selectedMeeting={selectedMeeting} hasTranscript={hasTranscript} reading={reading} /> : null}
        {activeTab === TRANSCRIPT_TAB && recording && !hasLiveSegments(selectedMeeting) ? <TrackingIndicator /> : null}
        {activeTab === TRANSCRIPT_TAB && (hasLiveSegments(selectedMeeting) || !recording) ? <TranscriptPanel meeting={selectedMeeting} transcript={transcript} reading={reading} /> : null}
      </div>
    </div>
  )
}

function DiarizationNotice({ meeting }: { meeting: MeetingDetail }) {
  const [busy, setBusy] = useState(false)
  if (meeting.diarization.state !== DEGRADED_STATE) return null
  const retry = async () => { setBusy(true); try { await window.gappd.meetings.retryDiarization(meeting.id) } catch {} finally { setBusy(false) } }
  return <div className="detail-surface"><span>{meeting.diarization.error ?? 'Speaker labeling unavailable.'}</span><div><Button className="compact-action" disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry'}</Button></div></div>
}

function SummaryPanel({ selectedMeeting, hasTranscript, reading }: { selectedMeeting: MeetingDetail; hasTranscript: boolean; reading: ReturnType<typeof useReadingOverflow> }) {
  const progress = detailProgressInput(selectedMeeting, hasTranscript)
  if (!selectedMeeting.summary && showPostMeetingProgress(selectedMeeting, progress)) return <PostMeetingProgressCard meeting={progress} />
  return <ReadingCard value={selectedMeeting.summary ?? ''} emptyText={summaryEmptyText(progress)} reading={reading} markdown />
}

function tabCopyValue(activeTab: DetailTab, meeting: MeetingDetail, transcript: string): string {
  return activeTab === SUMMARY_TAB ? meeting.summary ?? '' : transcript
}

function tabCopyLabel(activeTab: DetailTab): string { return activeTab === SUMMARY_TAB ? 'Copy summary' : 'Copy transcript' }

function showPostMeetingProgress(meeting: MeetingDetail, progress: MeetingProgressInput): boolean {
  return meeting.status.state !== RECORDING_STATE && (meetingHasWork(progress) || meetingFailed(progress))
}

function TranscriptPanel({ meeting, transcript, reading }: { meeting: MeetingDetail; transcript: string; reading: ReturnType<typeof useReadingOverflow> }) {
  const provisional = meeting.transcriptProvisional
  return <><div className="meeting-section-label">{provisional ? 'Live Transcript' : 'Transcript'}</div><ReadingCard value={transcript} emptyText={transcriptEmptyText(meeting)} reading={reading}><TranscriptText value={transcript} segments={meeting.segments ?? []} /></ReadingCard></>
}

function hasLiveSegments(meeting: MeetingDetail): boolean { return (meeting.segments?.length ?? 0) > 0 }
function TrackingIndicator() { return <div className="detail-surface detail-block"><div className="meeting-section-label">Live Transcript</div><p>Listening for speech…</p></div> }

function detailSubtitle(meeting: MeetingDetail, progress: MeetingProgressInput): string {
  if (meeting.status.state === RECORDING_STATE) return 'Recording audio · transcript after stop.'
  if (meeting.diarization.state === PENDING_STATE || meeting.diarization.state === PROCESSING_STATUS) return 'Labeling speakers locally.'
  if (meetingHasWork(progress) && progress.hasTranscript) return 'Creating summary with local AI.'
  if (meetingHasWork(progress)) return 'Transcribing audio locally.'
  if (progress.hasTranscript && progress.hasSummary) return ''
  if (progress.hasTranscript) return 'Transcript available.'
  if (meeting.status.state === PENDING_STATE) return 'Audio captured · waiting to process.'
  return 'Analysis and transcript for selected meeting.'
}

function summaryEmptyText(progress: MeetingProgressInput): string { return progress.hasTranscript ? 'Transcript available. Summary not generated yet.' : 'Summary appears after recording is processed.' }

function transcriptEmptyText(meeting: MeetingDetail): string {
  if (meetingIsProcessing(meeting)) return 'Transcript is being created locally…'
  return 'No transcript yet.'
}

function detailProgressInput(meeting: MeetingDetail, hasTranscript: boolean): MeetingProgressInput {
  return { status: meeting.status, hasTranscript: hasTranscript && !meeting.transcriptProvisional, hasSummary: Boolean(meeting.summary) }
}

function detailTranscript(meeting: MeetingDetail, transcript: string): string {
  return transcript || segmentsTranscript(meeting.segments ?? [])
}

function segmentsTranscript(segments: MeetingSegment[]): string {
  return segments.map(segmentTranscriptLine).filter(Boolean).join('\n')
}

function segmentTranscriptLine(segment: MeetingSegment): string {
  if (!segment.text) return ''
  return `${segment.speaker ? `[${segment.speaker}] ` : ''}${segment.text}`
}

export function MeetingDetailPanel(props: MeetingDetailPanelProps) {
  const { selectedMeetingId, selectedMeeting, selectedMeetingLoading, selectedMeetingError, transcript } = props
  if (selectedMeetingLoading) return <DetailShell><EmptyState>Loading meeting…</EmptyState></DetailShell>
  if (selectedMeetingError) return <DetailShell><SelectedMeetingError message={selectedMeetingError} /></DetailShell>
  if (!selectedMeetingId || !selectedMeeting) return <DetailShell><EmptyState>Select a meeting to view details.</EmptyState></DetailShell>
  return <SelectedMeetingDetail selectedMeeting={selectedMeeting} transcript={transcript} />
}

function SelectedMeetingError({ message }: { message: string }) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null)
  if (dismissedMessage === message) return <EmptyState>Select a meeting to view details.</EmptyState>
  return <div className="detail-surface detail-alert dismissible-note"><span>{message}</span><button className="icon-dismiss" type="button" aria-label="Dismiss error" onClick={() => setDismissedMessage(message)}>×</button></div>
}
