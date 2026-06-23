import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Device, LocalAIConfig, MeetingDetail, MeetingListItem } from '../shared/contracts'
import type { RecordingEvent } from '../shared/generated/contracts'
import { requestCommand, streamCommand } from './app-protocol'
import { childEnv, resolveCaptureApp, resolveCaptureBinary } from './native-runtime'
import { getRecordingState, setRecordingState } from './state'
import { getValidatedManagedWhisperPaths, resolveBundledWhisperBinary, resolveManagedWhisperModelPath } from './whisper'

const STALE_RECORDING_RECOVERY_INTERVAL_MS = 60_000

let recordingChild: ReturnType<typeof spawn> | null = null
let staleRecoveryTimer: NodeJS.Timeout | null = null
let staleRecoveryRunning = false

export function requestCapturePermissions(): Promise<{ microphone: string; screen: string }> {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `gappd-perms-${Date.now()}.json`)
    const command = capturePermissionCommand(tmpFile)
    const child = spawn(command.bin, command.args, { env: capturePermissionEnv(), stdio: ['ignore', 'ignore', 'ignore'] })
    child.on('close', () => resolvePermissionResult(tmpFile, resolve))
    child.on('error', () => resolve({ microphone: 'unknown', screen: 'unknown' }))
  })
}

function capturePermissionCommand(tmpFile: string): { bin: string; args: string[] } {
  const appPath = resolveCaptureApp()
  if (appPath) return { bin: '/usr/bin/open', args: ['-W', '-n', appPath, '--args', '--request-permissions', '--output', tmpFile] }
  return { bin: resolveCaptureBinary(), args: ['--request-permissions', '--output', tmpFile] }
}

function capturePermissionEnv(): NodeJS.ProcessEnv {
  return childEnv({ GAPPD_CAPTURE_APP_PATH: resolveCaptureApp() ?? '', GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary() })
}

export async function getDevices(): Promise<Device[]> {
  const result = await requestCommand('devices.list', {})
  return result.devices
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const result = await requestCommand('meetings.list', {})
  return result.meetings
}

export async function showMeeting(id: string): Promise<MeetingDetail> {
  const result = await requestCommand('meetings.show', { id })
  return result.meeting
}

export async function getLocalAIConfig(): Promise<LocalAIConfig> {
  const result = await requestCommand('config.show', {})
  return result.ai
}

export async function saveManagedLocalAIConfig(input: { endpoint: string; model: string; temperature?: number }): Promise<LocalAIConfig> {
  const result = await requestCommand('config.useManagedOllama', input)
  return result.ai
}

export function startStaleRecordingRecovery(): void {
  if (staleRecoveryTimer) return
  void runStaleRecordingRecovery()
  staleRecoveryTimer = setInterval(() => void runStaleRecordingRecovery(), STALE_RECORDING_RECOVERY_INTERVAL_MS)
}

export function stopStaleRecordingRecovery(): void {
  if (!staleRecoveryTimer) return
  clearInterval(staleRecoveryTimer)
  staleRecoveryTimer = null
}

export async function recoverStaleRecordings(): Promise<number> {
  const result = await requestCommand('record.recoverStale', { modelPath: resolveManagedWhisperModelPath() }, { GAPPD_WHISPER_BIN: resolveBundledWhisperBinary() })
  return result.recovered
}

export async function startRecording(input: { title: string; device: number; mode: string; modelPath?: string }): Promise<void> {
  if (recordingChild) throw new Error('A recording is already running')
  const whisper = await getValidatedManagedWhisperPaths()
  recordingChild = streamCommand('record.start', { ...input, modelPath: whisper.modelPath }, recordingHandlers(input.title), { GAPPD_WHISPER_BIN: whisper.binaryPath })
}

export function stopRecording(): void {
  if (!recordingChild) return
  setRecordingState({ ...getRecordingState(), status: 'stopping' })
  recordingChild.kill('SIGINT')
}

function resolvePermissionResult(tmpFile: string, resolve: (value: { microphone: string; screen: string }) => void): void {
  try {
    resolve(JSON.parse(fs.readFileSync(tmpFile, 'utf8')))
  } catch {
    resolve({ microphone: 'unknown', screen: 'unknown' })
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

async function runStaleRecordingRecovery(): Promise<void> {
  if (staleRecoveryRunning) return
  staleRecoveryRunning = true
  try {
    await recoverStaleRecordings()
  } catch (error) {
    console.error('stale recording recovery failed', error)
  } finally {
    staleRecoveryRunning = false
  }
}

function recordingHandlers(title: string) {
  return {
    onEvent(event: RecordingEvent) {
      setRecordingState(recordingStateFromEvent(event))
    },
    onError(error: string) {
      recordingChild = null
      setRecordingState({ status: 'error', title, error })
    },
    onExitWithoutTerminal() {
      recordingChild = null
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
      return { ...base, status: 'idle' as const }
    case 'recording.failed':
      recordingChild = null
      return { ...base, status: 'error' as const, error: event.error ?? protocolFailureMessage(event) }
  }
}

function protocolFailureMessage(event: RecordingEvent): string {
  return event.status.capture.failureMessage ?? event.status.processing.failureMessage ?? 'Recording failed'
}
