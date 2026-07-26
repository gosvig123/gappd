import type { RecordingState } from '../shared/contracts'
import { RECORDING_STATUS_RECORDING } from '../shared/meeting-recording-workflow'
import { dismissAutoStopPrompt, showAutoStopPrompt } from './meeting-notification'

const ABSENCE_GRACE_MS = 10_000
const STOP_COUNTDOWN_MS = 30_000
const STOP_COUNTDOWN_SECONDS = STOP_COUNTDOWN_MS / 1_000

type TrackedRecording = { key: string; title: string; meetingId?: string }
type Dependencies = {
  getState: () => RecordingState
  isSignalActive: (key: string) => boolean
  stopRecording: () => void
}

export function createAssistedRecordingStop(dependencies: Dependencies) {
  let tracked: TrackedRecording | null = null
  let graceTimer: NodeJS.Timeout | null = null
  let stopTimer: NodeJS.Timeout | null = null
  let keepUntilSignalReturns = false

  function track(input: TrackedRecording): void {
    reset()
    tracked = input
    if (!dependencies.isSignalActive(input.key)) signalLost(input.key)
  }

  function signalLost(key: string): void {
    if (tracked?.key !== key || keepUntilSignalReturns || graceTimer || stopTimer) return
    graceTimer = setTimeout(showStopPrompt, ABSENCE_GRACE_MS)
  }

  function signalFound(key: string): void {
    if (tracked?.key !== key) return
    keepUntilSignalReturns = false
    cancelPending()
  }

  function recordingStateChanged(state: RecordingState): void {
    if (state.status !== RECORDING_STATUS_RECORDING) reset()
  }

  function observerUnavailable(): void {
    cancelPending()
  }

  function showStopPrompt(): void {
    graceTimer = null
    if (!canStopTrackedRecording()) return
    showAutoStopPrompt({
      title: tracked!.title,
      seconds: STOP_COUNTDOWN_SECONDS,
      onKeep: keepRecording,
      onStop: stopNow,
    })
    stopTimer = setTimeout(stopNow, STOP_COUNTDOWN_MS)
  }

  function keepRecording(): void {
    keepUntilSignalReturns = true
    cancelPending()
  }

  function stopNow(): void {
    if (!canStopTrackedRecording()) return cancelPending()
    cancelPending()
    dependencies.stopRecording()
  }

  function canStopTrackedRecording(): boolean {
    if (!tracked || dependencies.isSignalActive(tracked.key)) return false
    const state = dependencies.getState()
    if (state.status !== RECORDING_STATUS_RECORDING) return false
    return !tracked.meetingId || !state.meetingId || tracked.meetingId === state.meetingId
  }

  function cancelPending(): void {
    if (graceTimer) clearTimeout(graceTimer)
    if (stopTimer) clearTimeout(stopTimer)
    graceTimer = null
    stopTimer = null
    dismissAutoStopPrompt()
  }

  function reset(): void {
    cancelPending()
    tracked = null
    keepUntilSignalReturns = false
  }

  return { track, signalLost, signalFound, recordingStateChanged, observerUnavailable, reset }
}
