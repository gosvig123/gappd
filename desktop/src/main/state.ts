import type { RecordingState } from '../shared/contracts'
import { RECORDING_STATUS_IDLE } from '../shared/meeting-recording-workflow'
import { createObservableState } from './observable-state'

export type { RecordingState }

const recordingState = createObservableState<RecordingState>({ status: RECORDING_STATUS_IDLE })

export const getRecordingState = recordingState.get
export const setRecordingState = recordingState.set
export const onRecordingStateChange = recordingState.subscribe
