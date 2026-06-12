import type { Device, MeetingListItem, MeetingState, ProcessingStatus, RecordingStatus } from '../../shared/contracts'

export const EMPTY_TITLE = 'Untitled meeting'
export const INBOX_READY = 'ready'
export const INBOX_PROCESSING = 'processing'
export const INBOX_ALL = 'all'
export const INBOX_FILTERS = [INBOX_READY, INBOX_PROCESSING, INBOX_ALL] as const

const MEETING_FAILED: MeetingState = 'failed'
const MEETING_PROCESSING: MeetingState = 'processing'
const MEETING_RECORDING: MeetingState = 'recording'
const PROCESSING_FAILED: ProcessingStatus = 'failed'
const PROCESSING_PROCESSING: ProcessingStatus = 'processing'
const RECORDING_RECORDING: RecordingStatus = 'recording'

export type InboxFilter = typeof INBOX_FILTERS[number]
export type InboxCounts = Record<InboxFilter, number>

export type CaptureReadiness = {
  detail: string
}

export function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

export function buildInboxCounts(meetings: MeetingListItem[]): InboxCounts {
  return {
    [INBOX_READY]: meetings.filter(isReadyToReview).length,
    [INBOX_PROCESSING]: meetings.filter(isInboxProcessing).length,
    [INBOX_ALL]: meetings.length,
  }
}

export function filterInboxMeetings(meetings: MeetingListItem[], filter: InboxFilter): MeetingListItem[] {
  if (filter === INBOX_READY) return meetings.filter(isReadyToReview)
  if (filter === INBOX_PROCESSING) return meetings.filter(isInboxProcessing)
  return meetings
}

export function readyState(canStart: boolean, canStop: boolean, devices: Device[], status: RecordingStatus): CaptureReadiness {
  if (status === RECORDING_RECORDING) return { detail: 'Stop when meeting ends. Notes appear in inbox after processing.' }
  if (canStop) return { detail: 'Audio handoff is underway. Keep app open.' }
  if (!devices.length) return { detail: 'Connect or enable input device before recording.' }
  if (canStart) return { detail: 'Start manual capture when meeting begins.' }
  return { detail: 'Wait for current meeting before starting another.' }
}

function hasFailure(meeting: MeetingListItem): boolean {
  return meeting.status.state === MEETING_FAILED || meeting.status.processing.state === PROCESSING_FAILED
}

function isProcessing(meeting: MeetingListItem): boolean {
  const processing = meeting.status.processing.state === PROCESSING_PROCESSING
  const active = meeting.status.state === MEETING_RECORDING || meeting.status.state === MEETING_PROCESSING
  return active || processing
}

function isInboxProcessing(meeting: MeetingListItem): boolean {
  return !isReadyToReview(meeting) && isProcessing(meeting)
}

function isReadyToReview(meeting: MeetingListItem): boolean {
  return hasFailure(meeting) || meeting.hasSummary || meeting.hasTranscript
}
