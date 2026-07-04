import type { spawn } from 'node:child_process'
import type { RecordingEvent } from '../shared/generated/contracts'
import { streamCommand } from './app-protocol'
import { ensureManagedLocalAIReady } from './local-ai-config'
import { logMainProcessMemory } from './memory'
import { getRecordingState, setRecordingState } from './state'
import { stopManagedLlamaCpp } from './llamacpp'

type RecordingChild = ReturnType<typeof spawn>

const RECORDING_SHUTDOWN_TIMEOUT_MS = 5_000
const RECORDING_STATUS_STOPPING = 'stopping'
const RECORDING_STATUS_PROCESSING = 'processing'
const STOP_IGNORED_RECORDING_STATUSES = new Set<string>([RECORDING_STATUS_STOPPING, RECORDING_STATUS_PROCESSING])

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
  if (STOP_IGNORED_RECORDING_STATUSES.has(state.status)) return
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
      setRecordingState(recordingStateFromEvent(event))
    },
    onError(error: string) {
      recordingChild = null
      void releaseManagedRuntimeAfterRecording('recording:error')
      setRecordingState({ status: 'error', title, error })
    },
    onExitWithoutTerminal() {
      recordingChild = null
      void releaseManagedRuntimeAfterRecording('recording:exit')
      if (getRecordingState().status !== 'error') setRecordingState({ status: 'idle' })
    },
  }
}

function recordingStateFromEvent(event: RecordingEvent) {
  const base = { meetingId: event.meetingId, title: event.title }
  switch (event.type) {
    case 'recording.started':
      return { ...base, status: 'recording' as const }
    case 'recording.stopping':
      return { ...base, status: 'stopping' as const }
    case 'recording.processing':
      return { ...base, status: 'processing' as const }
    case 'recording.completed':
      recordingChild = null
      void releaseManagedRuntimeAfterRecording('recording:completed')
      return { ...base, status: 'idle' as const }
    case 'recording.failed':
      recordingChild = null
      void releaseManagedRuntimeAfterRecording('recording:failed')
      return { ...base, status: 'error' as const, error: event.error ?? protocolFailureMessage(event) }
  }
}

async function releaseManagedRuntimeAfterRecording(label: string): Promise<void> {
  logMainProcessMemory(`${label}:before-runtime-stop`)
  await stopManagedLlamaCpp()
  logMainProcessMemory(`${label}:after-runtime-stop`)
}

function protocolFailureMessage(event: RecordingEvent): string {
  return event.status.capture.failureMessage ?? event.status.processing.failureMessage ?? 'Recording failed'
}
