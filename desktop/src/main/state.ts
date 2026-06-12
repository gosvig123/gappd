import type { RecordingState } from '../shared/contracts'
import { createObservableState } from './observable-state'

export type { RecordingState }

const recordingState = createObservableState<RecordingState>({ status: 'idle' })

export const getRecordingState = recordingState.get
export const setRecordingState = recordingState.set
export const onRecordingStateChange = recordingState.subscribe
