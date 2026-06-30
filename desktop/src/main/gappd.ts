import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { systemPreferences } from 'electron'
import type { Device, LocalAIConfig, MeetingDeleteResponse, MeetingDetail, MeetingListItem } from '../shared/contracts'
import type { RecordingEvent } from '../shared/generated/contracts'
import type { CapturePermissions } from '../shared/ipc-contract'
import { requestCommand, streamCommand } from './app-protocol'
import { childEnv, resolveCaptureApp, resolveCaptureBinary } from './native-runtime'
import { logMainProcessMemory } from './memory'
import { getRecordingState, setRecordingState } from './state'
import { stopManagedOllama } from './ollama'
import { getValidatedManagedWhisperPaths } from './whisper'

const STALE_RECORDING_RECOVERY_INTERVAL_MS = 60_000
const RECORDING_SHUTDOWN_TIMEOUT_MS = 5_000
const RECORDING_STATUS_STOPPING = 'stopping'
const RECORDING_STATUS_PROCESSING = 'processing'
const STOP_IGNORED_RECORDING_STATUSES = new Set<string>([RECORDING_STATUS_STOPPING, RECORDING_STATUS_PROCESSING])

let recordingChild: ReturnType<typeof spawn> | null = null
let staleRecoveryTimer: NodeJS.Timeout | null = null
let staleRecoveryRunning = false

export async function requestCapturePermissions(): Promise<CapturePermissions> {
  // The capture helper runs as a child of this app, so macOS TCC attributes the
  // helper's microphone request to the responsible process — this Electron app.
  // If the app has never been granted microphone access the helper's request
  // resolves to "denied" without ever showing a prompt. Request access here so
  // the prompt appears as "Gappd" (the app the user recognizes) and the helper
  // inherits the grant.
  const appMicStatusBefore = await ensureAppMicrophoneAccess()
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `gappd-perms-${Date.now()}.json`)
    const command = capturePermissionCommand(tmpFile)
    const details = { ...capturePermissionDetails(command), ...appMicStatusBefore }
    let stderr = ''
    const child = spawn(command.bin, command.args, { env: capturePermissionEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('close', (code) => resolvePermissionResult(tmpFile, resolve, { ...details, exitCode: String(code ?? ''), stderr: stderr.trim() }))
    child.on('error', (error) => resolve({ microphone: 'unknown', screen: 'unknown', details: { ...details, error: error.message } }))
  })
}

// Requests microphone access for this app (dev.gappd.desktop) on macOS. The app
// is the TCC-responsible process for the capture helper, so granting it here is
// what lets the helper record. Returns debug fields describing the transition.
async function ensureAppMicrophoneAccess(): Promise<Record<string, string>> {
  if (process.platform !== 'darwin') return {}
  const before = systemPreferences.getMediaAccessStatus('microphone')
  if (before !== 'not-determined') return { appMicStatusBefore: before, appMicStatusAfter: before }
  let granted = false
  try {
    granted = await systemPreferences.askForMediaAccess('microphone')
  } catch (error) {
    return { appMicStatusBefore: before, appMicStatusAfter: 'error', appMicError: String(error) }
  }
  return { appMicStatusBefore: before, appMicStatusAfter: granted ? 'granted' : 'denied' }
}

function capturePermissionCommand(tmpFile: string): { bin: string; args: string[] } {
  const appPath = resolveCaptureApp()
  if (appPath) return { bin: '/usr/bin/open', args: ['-W', '-n', appPath, '--args', '--request-permissions', '--output', tmpFile] }
  return { bin: resolveCaptureBinary(), args: ['--request-permissions', '--output', tmpFile] }
}

function capturePermissionEnv(): NodeJS.ProcessEnv {
  return childEnv({ GAPPD_CAPTURE_APP_PATH: resolveCaptureApp() ?? '', GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary() })
}

function capturePermissionDetails(command: { bin: string; args: string[] }): Record<string, string> {
  const appPath = resolveCaptureApp() ?? ''
  const helperPath = resolveCaptureBinary()
  return {
    launch: [command.bin, ...command.args].join(' '),
    appPath,
    helperPath,
    appExists: String(Boolean(appPath && fs.existsSync(appPath))),
    helperExists: String(fs.existsSync(helperPath)),
  }
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

export async function deleteMeeting(id: string): Promise<MeetingDeleteResponse> {
  return requestCommand('meetings.delete', { id })
}

export async function getLocalAIConfig(): Promise<LocalAIConfig> {
  const result = await requestCommand('config.show', {})
  return result.ai
}

export async function saveManagedLocalAIConfig(input: { endpoint: string; model: string; temperature?: number }): Promise<LocalAIConfig> {
  const result = await requestCommand('config.useManagedOllama', input)
  return result.ai
}

export async function startStaleRecordingRecovery(): Promise<number> {
  if (!staleRecoveryTimer) staleRecoveryTimer = setInterval(() => void runStaleRecordingRecovery(), STALE_RECORDING_RECOVERY_INTERVAL_MS)
  return runStaleRecordingRecovery()
}

export function stopStaleRecordingRecovery(): void {
  if (!staleRecoveryTimer) return
  clearInterval(staleRecoveryTimer)
  staleRecoveryTimer = null
}

export async function recoverStaleRecordings(): Promise<number> {
  const whisper = await getValidatedManagedWhisperPaths()
  const result = await requestCommand('record.recoverStale', { modelPath: whisper.modelPath }, { GAPPD_WHISPER_BIN: whisper.binaryPath })
  return result.recovered
}

export async function startRecording(input: { title: string; device: number; mode: string; modelPath?: string }): Promise<void> {
  if (recordingChild) throw new Error('A recording is already running')
  const whisper = await getValidatedManagedWhisperPaths()
  logMainProcessMemory('recording:start')
  recordingChild = streamCommand('record.start', { ...input, modelPath: whisper.modelPath }, recordingHandlers(input.title), { GAPPD_WHISPER_BIN: whisper.binaryPath })
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

function waitForRecordingExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (childExited(child)) return resolve()
    const timer = setTimeout(() => { if (!childExited(child)) child.kill('SIGKILL') }, RECORDING_SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function childExited(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function resolvePermissionResult(tmpFile: string, resolve: (value: CapturePermissions) => void, details: Record<string, string>): void {
  try {
    const result = JSON.parse(fs.readFileSync(tmpFile, 'utf8'))
    resolve({ ...result, details: cleanPermissionDetails({ ...details, ...result }) })
  } catch {
    resolve({ microphone: 'unknown', screen: 'unknown', details })
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

function cleanPermissionDetails(details: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'microphone' && key !== 'screen'))
}

async function runStaleRecordingRecovery(): Promise<number> {
  if (staleRecoveryRunning) return 0
  staleRecoveryRunning = true
  try {
    return await recoverStaleRecordings()
  } catch (error) {
    console.error('stale recording recovery failed', error)
    return 0
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
      void releaseManagedOllamaAfterRecording('recording:error')
      setRecordingState({ status: 'error', title, error })
    },
    onExitWithoutTerminal() {
      recordingChild = null
      void releaseManagedOllamaAfterRecording('recording:exit')
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
      void releaseManagedOllamaAfterRecording('recording:completed')
      return { ...base, status: 'idle' as const }
    case 'recording.failed':
      recordingChild = null
      void releaseManagedOllamaAfterRecording('recording:failed')
      return { ...base, status: 'error' as const, error: event.error ?? protocolFailureMessage(event) }
  }
}

async function releaseManagedOllamaAfterRecording(label: string): Promise<void> {
  logMainProcessMemory(`${label}:before-ollama-stop`)
  await stopManagedOllama()
  logMainProcessMemory(`${label}:after-ollama-stop`)
}

function protocolFailureMessage(event: RecordingEvent): string {
  return event.status.capture.failureMessage ?? event.status.processing.failureMessage ?? 'Recording failed'
}
