import type { MeetingStatus, RecordingEvent } from './generated/contracts'

export const RECORDING_STATUS_IDLE = 'idle'
export const RECORDING_STATUS_RECORDING = 'recording'
export const RECORDING_STATUS_STOPPING = 'stopping'
export const RECORDING_STATUS_PROCESSING = 'processing'
export const RECORDING_STATUS_ERROR = 'error'

export const RECORDING_STATUSES = [RECORDING_STATUS_IDLE, RECORDING_STATUS_RECORDING, RECORDING_STATUS_STOPPING, RECORDING_STATUS_PROCESSING, RECORDING_STATUS_ERROR] as const
export type RecordingStatus = (typeof RECORDING_STATUSES)[number]

export type RecordingState = {
  status: RecordingStatus
  meetingId?: string
  title?: string
  error?: string
}

type MeetingStatusTone = 'recording' | 'processing' | 'idle' | 'error'

type RecordingEventOutcome = {
  state: RecordingState
  releaseRuntime: boolean
}

export function recordingEventOutcome(event: RecordingEvent): RecordingEventOutcome {
  return { state: recordingStateFromEvent(event), releaseRuntime: isTerminalRecordingEvent(event) }
}

export function recordingStateFromEvent(event: RecordingEvent): RecordingState {
  const base = { meetingId: event.meetingId, title: event.title }
  switch (event.type) {
    case 'recording.started': return { ...base, status: RECORDING_STATUS_RECORDING }
    case 'recording.stopping': return { ...base, status: RECORDING_STATUS_STOPPING }
    case 'recording.processing': return { ...base, status: RECORDING_STATUS_PROCESSING }
    case 'recording.completed': return { ...base, status: RECORDING_STATUS_IDLE }
    case 'recording.failed': return { ...base, status: RECORDING_STATUS_ERROR, error: event.error ?? recordingFailureMessage(event) }
  }
}

export function canStartRecordingStatus(status: RecordingStatus): boolean {
  return status === RECORDING_STATUS_IDLE || status === RECORDING_STATUS_ERROR
}

export function canStopRecordingStatus(status: RecordingStatus): boolean {
  return status === RECORDING_STATUS_RECORDING
}

export function ignoresStopRequest(status: RecordingStatus): boolean {
  return status === RECORDING_STATUS_STOPPING || status === RECORDING_STATUS_PROCESSING
}

export function needsRecordingRefresh(status: RecordingStatus): boolean {
  return status === RECORDING_STATUS_RECORDING || status === RECORDING_STATUS_STOPPING || status === RECORDING_STATUS_PROCESSING
}

export function postStopNoticeVisible(status: RecordingStatus): boolean {
  return status === RECORDING_STATUS_PROCESSING
}

export function recordingRefreshTarget(state: RecordingState): string | null | undefined {
  if (state.meetingId) return state.meetingId
  return canStartRecordingStatus(state.status) ? null : undefined
}

export function meetingStatusTone(state: MeetingStatus['state']): MeetingStatusTone {
  switch (state) {
    case 'recording': return 'recording'
    case 'processing': return 'processing'
    case 'failed': return 'error'
    case 'captured':
    case 'completed': return 'idle'
  }
}

export function meetingStatusPillVisible(state: MeetingStatus['state']): boolean {
  return meetingStatusTone(state) !== 'idle'
}

function isTerminalRecordingEvent(event: RecordingEvent): boolean {
  return event.type === 'recording.completed' || event.type === 'recording.failed'
}

function recordingFailureMessage(event: RecordingEvent): string {
  return event.status.capture.failureMessage ?? event.status.processing.failureMessage ?? 'Recording failed'
}
