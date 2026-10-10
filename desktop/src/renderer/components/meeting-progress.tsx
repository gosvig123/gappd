import type { MeetingStatus } from '../../shared/contracts'

type MeetingProgressInput = {
  status: MeetingStatus
  hasTranscript: boolean
  hasSummary: boolean
}

const MEETING_RECORDING = 'recording'
const MEETING_PENDING = 'pending'
const MEETING_FAILED = 'failed'
const CAPTURE_FAILED = 'failed'
const PROCESSING_PROCESSING = 'processing'
const PROCESSING_COMPLETED = 'completed'
const PROCESSING_FAILED = 'failed'

export function meetingProgressLabel(meeting: MeetingProgressInput): string {
  if (meeting.status.state === MEETING_RECORDING) return 'Recording'
  if (meetingFailed(meeting)) return 'Failed'
  if (meeting.status.processing.state === PROCESSING_PROCESSING) return activeWorkLabel(meeting)
  if (meetingReady(meeting)) return 'Ready'
  if (meeting.status.state === MEETING_PENDING) return 'Pending'
  if (meeting.status.processing.state === PROCESSING_COMPLETED) return completedLabel()
  return 'Processing'
}

export function meetingHasWork(meeting: Pick<MeetingProgressInput, 'status'>): boolean {
  return meeting.status.state === MEETING_RECORDING || meeting.status.processing.state === PROCESSING_PROCESSING
}

export function meetingReady(meeting: MeetingProgressInput): boolean {
  return meeting.hasTranscript && meeting.hasSummary
}

export function meetingFailed(meeting: MeetingProgressInput): boolean {
  return meeting.status.state === MEETING_FAILED || meeting.status.capture.state === CAPTURE_FAILED || meeting.status.processing.state === PROCESSING_FAILED
}

function activeWorkLabel(meeting: MeetingProgressInput): string {
  if (!meeting.hasTranscript) return 'Transcribing'
  if (!meeting.hasSummary) return 'Creating summary'
  return 'Finishing notes'
}

function completedLabel(): string { return 'Completed' }
