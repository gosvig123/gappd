import type { RecordingEvent } from './generated/contracts'

export { meetingStatusPillVisible, meetingStatusTone } from './generated/lifecycle'
export const RECORDING_STATUS_IDLE = 'idle'
export const RECORDING_STATUS_RECORDING = 'recording'
export const RECORDING_STATUS_STOPPING = 'stopping'
export const RECORDING_STATUS_ERROR = 'error'
export const RECORDING_STATUSES = [RECORDING_STATUS_IDLE, RECORDING_STATUS_RECORDING, RECORDING_STATUS_STOPPING, RECORDING_STATUS_ERROR] as const
export type RecordingStatus = (typeof RECORDING_STATUSES)[number]

export type RecordingState = { status: RecordingStatus; meetingId?: string; title?: string; error?: string }
type RecordingEventOutcome = { state: RecordingState }

export function recordingEventOutcome(event: RecordingEvent): RecordingEventOutcome {
  return { state: recordingStateFromEvent(event) }
}

export function recordingStateFromEvent(event: RecordingEvent): RecordingState {
  const base = { meetingId: event.meetingId, title: event.title }
  switch (event.type) {
    case 'recording.started': return { ...base, status: RECORDING_STATUS_RECORDING }
    case 'recording.stopping': return { ...base, status: RECORDING_STATUS_STOPPING }
    case 'recording.captured': return { ...base, status: RECORDING_STATUS_IDLE }
    case 'recording.failed': return { ...base, status: RECORDING_STATUS_ERROR, error: event.error ?? recordingFailureMessage(event) }
  }
}

export function canStartRecordingStatus(status: RecordingStatus): boolean {
  return status === RECORDING_STATUS_IDLE || status === RECORDING_STATUS_ERROR
}
export function canStopRecordingStatus(status: RecordingStatus): boolean { return status === RECORDING_STATUS_RECORDING }
export function ignoresStopRequest(status: RecordingStatus): boolean { return status === RECORDING_STATUS_STOPPING }
export function needsRecordingRefresh(status: RecordingStatus): boolean { return status === RECORDING_STATUS_RECORDING || status === RECORDING_STATUS_STOPPING }
export function recordingRefreshTarget(state: RecordingState): string | null | undefined {
  if (state.meetingId) return state.meetingId
  return canStartRecordingStatus(state.status) ? null : undefined
}
function recordingFailureMessage(event: RecordingEvent): string {
  return event.status.capture.failureMessage ?? event.status.processing.failureMessage ?? 'Recording failed'
}
