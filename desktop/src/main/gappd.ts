import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RECORDING_PROTOCOL_EVENT_TYPES, type Device, type LocalAIConfig, type MeetingDetail, type MeetingListItem, type MeetingStatus, type RecordingProtocolEventType } from '../shared/contracts'
import { resolveBinary } from './binaries'
import { getRecordingState, setRecordingState, type RecordingState } from './state'
import { getValidatedManagedWhisperPaths, resolveBundledWhisperBinary, resolveManagedWhisperModelPath } from './whisper'

type DevicesResponse = { devices: Device[] }
type MeetingsResponse = { meetings: MeetingListItem[] }
type MeetingResponse = { meeting: MeetingDetail }
type LocalAIConfigResponse = { ai: LocalAIConfig }
type RecoverStaleResponse = { recovered: number }
type RecordingProtocolEvent = {
  type: RecordingProtocolEventType
  meetingId: string
  title: string
  status: MeetingStatus
  error?: string
}

const STALE_RECORDING_RECOVERY_INTERVAL_MS = 60_000

let recordingChild: ReturnType<typeof spawn> | null = null
let staleRecoveryTimer: NodeJS.Timeout | null = null
let staleRecoveryRunning = false

export function resolveCaptureBinary(): string {
  return resolveBinary({
    envVar: 'GAPPD_CAPTURE_HELPER_PATH',
    packaged: ['GappdCapture.app', 'Contents', 'MacOS', 'gappd-capture'],
    dev: ['..', 'build', 'GappdCapture.app', 'Contents', 'MacOS', 'gappd-capture'],
  })
}

export function requestCapturePermissions(): Promise<{ microphone: string; screen: string }> {
  return new Promise((resolve) => {
    const bin = resolveCaptureBinary()
    const tmpFile = path.join(os.tmpdir(), `gappd-perms-${Date.now()}.json`)
    const child = spawn(bin, ['--request-permissions', '--output', tmpFile], {
      env: childEnv({ GAPPD_CAPTURE_HELPER_PATH: bin }),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    child.on('close', () => {
      try {
        resolve(JSON.parse(fs.readFileSync(tmpFile, 'utf8')))
      } catch {
        resolve({ microphone: 'unknown', screen: 'unknown' })
      } finally {
        try { fs.unlinkSync(tmpFile) } catch {}
      }
    })
    child.on('error', () => resolve({ microphone: 'unknown', screen: 'unknown' }))
  })
}

export function resolveGappdBinary(): string {
  return resolveBinary({
    envVar: 'GAPPD_BINARY_PATH',
    packaged: ['bin', 'gappd'],
    dev: ['..', 'build', 'gappd'],
  })
}

export async function getDevices(): Promise<Device[]> {
  const result = await runJSON<DevicesResponse>(['app', 'devices', '--json'])
  return result.devices
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const result = await runJSON<MeetingsResponse>(['app', 'meetings', 'list', '--json'])
  return result.meetings
}

export async function showMeeting(id: string): Promise<MeetingDetail> {
  const result = await runJSON<MeetingResponse>(['app', 'meetings', 'show', id, '--json'])
  return result.meeting
}

export async function getLocalAIConfig(): Promise<LocalAIConfig> {
  const result = await runJSON<LocalAIConfigResponse>(['app', 'config', 'show', '--json'])
  return result.ai
}

export async function saveManagedLocalAIConfig(input: {
  endpoint: string
  model: string
  temperature?: number
}): Promise<LocalAIConfig> {
  const args = [
    'app',
    'config',
    'use-managed-ollama',
    '--endpoint',
    input.endpoint,
    '--model',
    input.model,
  ]
  if (typeof input.temperature === 'number') args.push('--temperature', String(input.temperature))
  const result = await runJSON<LocalAIConfigResponse>(args)
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
  const result = await runJSON<RecoverStaleResponse>(['app', 'record', 'recover-stale', '--json', '--model', resolveManagedWhisperModelPath()], {
    GAPPD_WHISPER_BIN: resolveBundledWhisperBinary(),
  })
  return result.recovered
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

export async function startRecording(input: { title: string; device: number; mode: string; modelPath?: string }): Promise<void> {
  if (recordingChild) throw new Error('A recording is already running')

  const whisper = await getValidatedManagedWhisperPaths()
  const args = ['app', 'record', 'start', '--title', input.title, '--device', String(input.device), '--mode', input.mode, '--model', whisper.modelPath]

  let stderr = ''
  let stdoutBuffer = ''
  let sawTerminalEvent = false
  let sawProtocolEvent = false
  let protocolError: string | null = null
  const child = spawn(resolveGappdBinary(), args, {
    env: childEnv({
      GAPPD_WHISPER_BIN: whisper.binaryPath,
      GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary(),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  recordingChild = child

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = parseRecordingProtocolEvent(trimmed)
      if (!event) {
        protocolError = `Invalid recording protocol event: ${trimmed}`
        continue
      }
      sawProtocolEvent = true
      if (isTerminalProtocolEvent(event.type)) sawTerminalEvent = true
      setRecordingState(recordingStateFromEvent(event))
    }
  })

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  child.on('error', (error) => {
    recordingChild = null
    setRecordingState({ status: 'error', title: input.title, error: error.message })
  })

  child.on('exit', (code, signal) => {
    recordingChild = null
    if (sawTerminalEvent) return
    if (protocolError) {
      setRecordingState({ status: 'error', title: input.title, error: protocolError })
      return
    }
    if (stdoutBuffer.trim()) {
      setRecordingState({
        status: 'error',
        title: input.title,
        error: `Incomplete recording protocol event: ${stdoutBuffer.trim()}`,
      })
      return
    }
    if (code === 0 && !sawProtocolEvent) {
      setRecordingState({ status: 'idle' })
      return
    }
    if (signal === 'SIGINT' && getRecordingState().status !== 'error') {
      setRecordingState({ status: 'idle' })
      return
    }
    setRecordingState({
      status: 'error',
      title: input.title,
      error: formatChildError(stderr, code, signal),
    })
  })
}

export function stopRecording(): void {
  if (!recordingChild) return
  setRecordingState({ ...getRecordingState(), status: 'stopping' })
  recordingChild.kill('SIGINT')
}

export async function runJSON<T>(args: string[], env: NodeJS.ProcessEnv = {}): Promise<T> {
  const output = await runCommand(args, env)
  return JSON.parse(output) as T
}

function runCommand(args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGappdBinary(), args, {
      env: childEnv({ GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary(), ...env }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr || stdout || `gappd exited with code ${code}`))
    })
  })
}

export function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pathParts = [
    process.env.PATH ?? '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]

  return {
    ...process.env,
    PATH: Array.from(new Set(pathParts.filter(Boolean))).join(':'),
    ...overrides,
  }
}

function parseRecordingProtocolEvent(line: string): RecordingProtocolEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<RecordingProtocolEvent>
    if (!parsed.type || !parsed.meetingId || !parsed.title || !parsed.status) return null
    if (!isProtocolEventType(parsed.type)) return null
    return parsed as RecordingProtocolEvent
  } catch {
    return null
  }
}

function isProtocolEventType(value: string): value is RecordingProtocolEventType {
  const eventTypes: readonly string[] = RECORDING_PROTOCOL_EVENT_TYPES
  return eventTypes.includes(value)
}

function isTerminalProtocolEvent(type: RecordingProtocolEventType): boolean {
  return type === 'recording.completed' || type === 'recording.failed'
}

function recordingStateFromEvent(event: RecordingProtocolEvent): RecordingState {
  const base = { meetingId: event.meetingId, title: event.title }
  switch (event.type) {
    case 'recording.started':
      return { ...base, status: 'recording' }
    case 'recording.stopping':
      return { ...base, status: 'stopping' }
    case 'recording.processing':
      return { ...base, status: 'processing' }
    case 'recording.completed':
      return { ...base, status: 'idle' }
    case 'recording.failed':
      return { ...base, status: 'error', error: event.error ?? protocolFailureMessage(event.status) }
  }
}

function protocolFailureMessage(status: MeetingStatus): string {
  return status.capture.failureMessage ?? status.processing.failureMessage ?? 'Recording failed'
}

function formatChildError(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const cleaned = stderr.trim()
  if (cleaned) {
    const lines = cleaned.split('\n').filter(Boolean)
    return lines.slice(-8).join('\n')
  }
  return code === null ? `Process exited with signal ${signal}` : `Process exited with code ${code}`
}
