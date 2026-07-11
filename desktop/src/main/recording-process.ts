import type { spawn } from 'node:child_process'
import type { RecordingEvent } from '../shared/generated/contracts'
import { ignoresStopRequest, recordingEventOutcome, RECORDING_STATUS_ERROR, RECORDING_STATUS_IDLE, RECORDING_STATUS_STOPPING } from '../shared/meeting-recording-workflow'
import { streamCommand } from './app-protocol'
import { acquireManagedLocalAI, type LocalAILease } from './local-ai-config'
import { logMainProcessMemory } from './memory'
import { getRecordingState, setRecordingState } from './state'

type RecordingChild = ReturnType<typeof spawn>

const RECORDING_SHUTDOWN_TIMEOUT_MS = 5_000
const LIVE_TRANSCRIPT_CHUNK_SECONDS = '30'
let recordingChild: RecordingChild | null = null
let localAILease: LocalAILease | null = null

export async function startRecording(input: { title: string; device: number; mode: string; language: string }): Promise<void> {
  if (recordingChild) throw new Error('A recording is already running')
  const lease = await acquireManagedLocalAI()
  try {
    logMainProcessMemory('recording:start')
    recordingChild = streamCommand('record.start', input, recordingHandlers(input.title), { GAPPD_CAPTURE_CHUNK_SECONDS: LIVE_TRANSCRIPT_CHUNK_SECONDS })
    localAILease = lease
  } catch (error) {
    await lease.release()
    throw error
  }
}

export function stopRecording(): void {
  if (!recordingChild) return
  const state = getRecordingState()
  if (ignoresStopRequest(state.status)) return
  setRecordingState({ ...state, status: RECORDING_STATUS_STOPPING })
  logMainProcessMemory('recording:stop')
  recordingChild.kill('SIGINT')
}

export async function stopActiveRecordingForQuit(): Promise<void> {
  const child = recordingChild
  if (!child) return
  logMainProcessMemory('recording:quit-stop')
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
      const outcome = recordingEventOutcome(event)
      if (outcome.releaseRuntime) finishRecording(event.type)
      setRecordingState(outcome.state)
    },
    onError(error: string) {
      finishRecording('recording:error')
      setRecordingState({ status: RECORDING_STATUS_ERROR, title, error })
    },
    onExitWithoutTerminal() {
      finishRecording('recording:exit')
      if (getRecordingState().status !== RECORDING_STATUS_ERROR) setRecordingState({ status: RECORDING_STATUS_IDLE })
    },
  }
}

function finishRecording(label: string): void {
  recordingChild = null
  const lease = localAILease
  localAILease = null
  if (lease) void releaseManagedRuntimeAfterRecording(label, lease)
}

async function releaseManagedRuntimeAfterRecording(label: string, lease: LocalAILease): Promise<void> {
  logMainProcessMemory(`${label}:before-runtime-stop`)
  await lease.release()
  logMainProcessMemory(`${label}:after-runtime-stop`)
}
