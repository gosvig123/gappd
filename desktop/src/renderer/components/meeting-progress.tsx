import { type ReactNode } from 'react'
import type { MeetingStatus } from '../../shared/contracts'
import { cx } from './ui'
import { CircleCheckIcon, CircleDotIcon, CircleAlertIcon, CircleIcon } from './icons'
import './meeting-progress.css'

export type MeetingProgressInput = {
  status: MeetingStatus
  hasTranscript: boolean
  hasSummary: boolean
}

type StepTone = 'done' | 'active' | 'pending' | 'failed'

type ProgressStep = {
  label: string
  detail: string
  tone: StepTone
}

const MEETING_RECORDING = 'recording'
const MEETING_CAPTURED = 'captured'
const MEETING_FAILED = 'failed'
const CAPTURE_CAPTURED = 'captured'
const CAPTURE_FAILED = 'failed'
const PROCESSING_PROCESSING = 'processing'
const PROCESSING_COMPLETED = 'completed'
const PROCESSING_FAILED = 'failed'
const LONG_RUNNING_MS = 120_000

export function meetingProgressLabel(meeting: MeetingProgressInput): string {
  if (meeting.status.state === MEETING_RECORDING) return 'Recording'
  if (meetingFailed(meeting)) return 'Failed'
  if (meeting.status.processing.state === PROCESSING_PROCESSING) return activeWorkLabel(meeting)
  if (meetingReady(meeting)) return 'Ready'
  if (meeting.status.state === MEETING_CAPTURED) return 'Captured'
  if (meeting.status.processing.state === PROCESSING_COMPLETED) return completedLabel()
  return 'Processing'
}

export function meetingHasWork(meeting: MeetingProgressInput): boolean {
  return meeting.status.state === MEETING_RECORDING || meeting.status.processing.state === PROCESSING_PROCESSING
}

export function meetingReady(meeting: MeetingProgressInput): boolean {
  return meeting.hasTranscript && meeting.hasSummary
}

export function meetingFailed(meeting: MeetingProgressInput): boolean {
  return meeting.status.state === MEETING_FAILED || meeting.status.capture.state === CAPTURE_FAILED || meeting.status.processing.state === PROCESSING_FAILED
}

export function PostMeetingProgressCard({ meeting }: { meeting: MeetingProgressInput }) {
  return (
    <div className="detail-surface detail-block processing-card" aria-live="polite">
      <div className="processing-card-header">
        <div><div className="meeting-section-label">Finishing meeting notes</div><p>{processingLead(meeting)}</p></div>
        {meetingHasWork(meeting) ? <span className="processing-spinner" aria-hidden="true" /> : null}
      </div>
      <ol className="processing-steps">{progressSteps(meeting).map((step) => <ProcessingStep key={step.label} step={step} />)}</ol>
      <p className="processing-hint">{processingHint(meeting)}</p>
    </div>
  )
}

function ProcessingStep({ step }: { step: ProgressStep }) {
  return <li className={cx('processing-step', step.tone)}><span className="processing-step-marker">{stepMarkerIcon(step.tone)}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></li>
}

function activeWorkLabel(meeting: MeetingProgressInput): string {
  if (!meeting.hasTranscript) return 'Transcribing'
  if (!meeting.hasSummary) return 'Creating summary'
  return 'Finishing notes'
}

function completedLabel(): string { return 'Completed' }

function progressSteps(meeting: MeetingProgressInput): ProgressStep[] {
  return [audioStep(meeting), transcriptStep(meeting), summaryStep(meeting), readyStep(meeting)]
}

function audioStep(meeting: MeetingProgressInput): ProgressStep {
  if (meeting.status.capture.state === CAPTURE_FAILED) return { label: 'Audio capture', detail: 'Could not save recording.', tone: 'failed' }
  if (meeting.status.capture.state === CAPTURE_CAPTURED) return { label: 'Audio captured', detail: 'Recording saved locally.', tone: 'done' }
  return { label: 'Audio capture', detail: 'Recording still running.', tone: 'active' }
}

function transcriptStep(meeting: MeetingProgressInput): ProgressStep {
  if (meeting.hasTranscript) return { label: 'Transcript ready', detail: 'Speech converted to text.', tone: 'done' }
  if (meeting.status.processing.state === PROCESSING_FAILED) return { label: 'Transcribing audio', detail: 'Transcript did not finish.', tone: 'failed' }
  if (meeting.status.processing.state === PROCESSING_PROCESSING) return { label: 'Transcribing audio', detail: 'Local transcription is running.', tone: 'active' }
  return { label: 'Transcribing audio', detail: 'Waiting for processing.', tone: 'pending' }
}

function summaryStep(meeting: MeetingProgressInput): ProgressStep {
  if (meeting.hasSummary) return { label: 'Summary ready', detail: 'Notes generated.', tone: 'done' }
  if (summaryFailed(meeting)) return { label: 'Creating summary', detail: 'Summary did not finish.', tone: 'failed' }
  if (meeting.hasTranscript && meeting.status.processing.state === PROCESSING_PROCESSING) return { label: 'Creating summary', detail: 'Local AI is writing notes.', tone: 'active' }
  return { label: 'Creating summary', detail: 'Starts after transcript.', tone: 'pending' }
}

function readyStep(meeting: MeetingProgressInput): ProgressStep {
  if (meetingReady(meeting)) return { label: 'Ready', detail: 'Summary and transcript are available.', tone: 'done' }
  if (meetingFailed(meeting)) return { label: 'Ready', detail: 'Blocked by failed step.', tone: 'failed' }
  return { label: 'Ready', detail: 'Appears here when notes finish.', tone: 'pending' }
}

function processingLead(meeting: MeetingProgressInput): string {
  if (meetingFailed(meeting)) return 'Could not finish every step. Existing transcript or audio stays saved.'
  if (!meeting.hasTranscript) return 'Meeting saved. Transcribing audio locally.'
  if (!meeting.hasSummary) return 'Transcript ready. Creating summary with local AI.'
  return 'Finalizing meeting notes.'
}

function processingHint(meeting: MeetingProgressInput): string {
  if (!meetingHasWork(meeting)) return 'Done. Open summary or transcript anytime.'
  if (workingLong(meeting)) return 'Still working. Longer meetings can take several minutes. Keep app open.'
  return 'Keep app open. Longer meetings can take several minutes.'
}

function workingLong(meeting: MeetingProgressInput): boolean {
  if (meeting.status.processing.state !== PROCESSING_PROCESSING) return false
  const updatedAt = new Date(meeting.status.processing.updatedAt).getTime()
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > LONG_RUNNING_MS
}

function summaryFailed(meeting: MeetingProgressInput): boolean {
  return meeting.hasTranscript && !meeting.hasSummary && meeting.status.processing.state === PROCESSING_FAILED
}

function stepMarkerIcon(tone: StepTone): ReactNode {
  if (tone === 'done') return <CircleCheckIcon aria-hidden="true" />
  if (tone === 'active') return <CircleDotIcon aria-hidden="true" />
  if (tone === 'failed') return <CircleAlertIcon aria-hidden="true" />
  return <CircleIcon aria-hidden="true" />
}
