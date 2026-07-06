import type { spawn } from 'node:child_process'
import type { RecordingEvent } from '../shared/generated/contracts'
import { ignoresStopRequest, recordingEventOutcome, RECORDING_STATUS_ERROR, RECORDING_STATUS_IDLE, RECORDING_STATUS_STOPPING } from '../shared/meeting-recording-workflow'
import { streamCommand } from './app-protocol'
import { ensureManagedLocalAIReady } from './local-ai-config'
import { logMainProcessMemory } from './memory'
import { getRecordingState, setRecordingState } from './state'
import { stopManagedLlamaCpp } from './llamacpp'

type RecordingChild = ReturnType<typeof spawn>

const RECORDING_SHUTDOWN_TIMEOUT_MS = 5_000
let recordingChild: RecordingChild | null = null

export async function startRecording(input: { title: string; device: number; mode: string; language: string }): Promise<void> {
  if (recordingChild) throw new Error('A recording is already running')
  await ensureManagedLocalAIReady()
  logMainProcessMemory('recording:start')
  recordingChild = streamCommand('record.start', input, recordingHandlers(input.title))
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
  void releaseManagedRuntimeAfterRecording(label)
}

async function releaseManagedRuntimeAfterRecording(label: string): Promise<void> {
  logMainProcessMemory(`${label}:before-runtime-stop`)
  await stopManagedLlamaCpp()
  logMainProcessMemory(`${label}:after-runtime-stop`)
}
