import type { spawn } from 'node:child_process'
import type { RecordingEvent } from '../shared/generated/contracts'
import { ignoresStopRequest, recordingEventOutcome, RECORDING_STATUS_ERROR, RECORDING_STATUS_IDLE, RECORDING_STATUS_STOPPING } from '../shared/meeting-recording-workflow'
import { streamCommand } from './app-protocol'
import { requestDrains } from './drain-coordinator'
import { managedRuntime } from './managed-runtime'
import { logMainProcessMemory } from './memory'
import { getRecordingState, setRecordingState } from './state'

type RecordingChild = ReturnType<typeof spawn>
const RECORDING_SHUTDOWN_TIMEOUT_MS = 5_000
const LIVE_TRANSCRIPT_CHUNK_SECONDS = '300'
const LIVE_TRANSCRIPT_CHUNK_OVERLAP_SECONDS = '10'
let recordingChild: RecordingChild | null = null

export async function startRecording(input: { title: string; device: number; mode: string; language: string }): Promise<void> {
  if (recordingChild) throw new Error('A recording is already running')
  const snapshot = managedRuntime.status()
  const liveTranscript = snapshot.capabilities.transcription.readiness === 'ready'
  logMainProcessMemory('recording:start')
  recordingChild = streamCommand('record.start', input, recordingHandlers(input.title), {
    GAPPD_CAPTURE_CHUNK_SECONDS: liveTranscript ? LIVE_TRANSCRIPT_CHUNK_SECONDS : '',
    GAPPD_CAPTURE_CHUNK_OVERLAP_SECONDS: liveTranscript ? LIVE_TRANSCRIPT_CHUNK_OVERLAP_SECONDS : '',
  })
}

export function stopRecording(): void {
  if (!recordingChild || ignoresStopRequest(getRecordingState().status)) return
  setRecordingState({ ...getRecordingState(), status: RECORDING_STATUS_STOPPING })
  recordingChild.kill('SIGINT')
}

export async function stopActiveRecordingForQuit(): Promise<void> {
  const child = recordingChild
  if (!child) return
  child.kill('SIGINT')
  await waitForRecordingExit(child)
}

function waitForRecordingExit(child: RecordingChild): Promise<void> {
  return new Promise((resolve) => {
    if (childExited(child)) return resolve()
    const timer = setTimeout(() => { if (!childExited(child)) child.kill('SIGKILL') }, RECORDING_SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function childExited(child: RecordingChild): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function recordingHandlers(title: string) {
  return {
    onEvent(event: RecordingEvent) {
      setRecordingState(recordingEventOutcome(event).state)
      if (event.type === 'recording.captured') requestDrains()
      if (event.type === 'recording.captured' || event.type === 'recording.failed') finishRecording()
    },
    onError(error: string) { finishRecording(); setRecordingState({ status: RECORDING_STATUS_ERROR, title, error }) },
    onExitWithoutTerminal() {
      finishRecording()
      if (getRecordingState().status !== RECORDING_STATUS_ERROR) setRecordingState({ status: RECORDING_STATUS_IDLE })
    },
  }
}

function finishRecording(): void {
  recordingChild = null
  logMainProcessMemory('recording:finished')
}
