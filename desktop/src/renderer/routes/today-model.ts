import type { Device, MeetingListItem, MeetingState, ProcessingStatus, RecordingStatus } from '../../shared/contracts'

export const EMPTY_TITLE = 'Untitled meeting'
export const MAX_QUEUE_ITEMS = 4

const MEETING_FAILED: MeetingState = 'failed'
const MEETING_PROCESSING: MeetingState = 'processing'
const MEETING_RECORDING: MeetingState = 'recording'
const PROCESSING_FAILED: ProcessingStatus = 'failed'
const PROCESSING_PROCESSING: ProcessingStatus = 'processing'
const RECORDING_RECORDING: RecordingStatus = 'recording'

export type TodayQueues = {
  needsReview: MeetingListItem[]
  processing: MeetingListItem[]
  recent: MeetingListItem[]
}

export type CaptureReadiness = {
  tone: string
  title: string
  detail: string
}

export function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

export function buildQueues(meetings: MeetingListItem[]): TodayQueues {
  const needsReview = meetings.filter(isReadyToReview)
  const reviewIds = new Set(needsReview.map((meeting) => meeting.id))
  const processing = meetings.filter((meeting) => !reviewIds.has(meeting.id) && isProcessing(meeting))
  const queuedIds = new Set([...reviewIds, ...processing.map((meeting) => meeting.id)])
  const recent = meetings.filter((meeting) => !queuedIds.has(meeting.id)).slice(0, MAX_QUEUE_ITEMS)
  return { needsReview, processing, recent }
}

export function readyState(canStart: boolean, canStop: boolean, devices: Device[], status: RecordingStatus): CaptureReadiness {
  if (status === RECORDING_RECORDING) return { tone: 'recording', title: 'Recording now', detail: 'Stop when meeting ends. Notes appear in inbox after processing.' }
  if (canStop) return { tone: 'processing', title: 'Finishing capture', detail: 'Audio handoff is underway. Keep app open.' }
  if (!devices.length) return { tone: 'error', title: 'Microphone needed', detail: 'Connect or enable input device before recording.' }
  if (canStart) return { tone: 'idle', title: 'Ready to record', detail: 'Start manual capture when meeting begins.' }
  return { tone: 'processing', title: 'Recorder busy', detail: 'Wait for current meeting before starting another.' }
}

export function meetingSubtitle(meeting: MeetingListItem): string {
  if (hasFailure(meeting)) return 'Needs attention before notes are ready.'
  if (meeting.hasSummary) return 'Summary ready to review.'
  if (meeting.hasTranscript) return 'Transcript ready to review.'
  if (isProcessing(meeting)) return 'Notes are being prepared.'
  return 'Saved meeting.'
}

function hasFailure(meeting: MeetingListItem): boolean {
  return meeting.status.state === MEETING_FAILED || meeting.status.processing.state === PROCESSING_FAILED
}

function isProcessing(meeting: MeetingListItem): boolean {
  const processing = meeting.status.processing.state === PROCESSING_PROCESSING
  const active = meeting.status.state === MEETING_RECORDING || meeting.status.state === MEETING_PROCESSING
  return active || processing
}

function isReadyToReview(meeting: MeetingListItem): boolean {
  return hasFailure(meeting) || meeting.hasSummary || meeting.hasTranscript
}
