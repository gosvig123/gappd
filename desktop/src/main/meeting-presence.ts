import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { canStartRecordingStatus } from '../shared/meeting-recording-workflow'
import { createAssistedRecordingStop } from './assisted-recording-stop'
import { childEnv, resolveCaptureBinary } from './native-runtime'
import { dismissMeetingPrompt, showMeetingPrompt, stopMeetingPrompts } from './meeting-notification'
import { startMeetingRecordingWorkflow, stopMeetingRecordingWorkflow } from './meeting-recording-workflow'
import { getRecordingState, onRecordingStateChange } from './state'

const DEBOUNCE_MS = 4_000
const OBSERVER_RESTART_MS = 2_000
const DEV_SERVER_ENV = 'VITE_DEV_SERVER_URL'
const MAX_SIGNAL_FIELD_LENGTH = 512
const SUPPORTED_PROVIDERS = new Set(['Browser', 'Zoom', 'Microsoft Teams', 'Webex', 'Slack Huddle', 'FaceTime'])

type MeetingSignal = { provider: string; title: string; key: string }
type MeetingSnapshot = { meetings: MeetingSignal[] }

const activeSignals = new Map<string, MeetingSignal>()
const promptedKeys = new Set<string>()
const debounceTimers = new Map<string, NodeJS.Timeout>()
let observer: ChildProcessWithoutNullStreams | null = null
let observerRestartTimer: NodeJS.Timeout | null = null
let unsubscribeRecordingState: (() => void) | null = null
let stopping = false
let showApp = () => {}

const assistedStop = createAssistedRecordingStop({
  getState: getRecordingState,
  isSignalActive: (key) => activeSignals.has(key),
  stopRecording: stopMeetingRecordingWorkflow,
})

export function startMeetingPresence(showMainWindow: () => void): void {
  showApp = showMainWindow
  stopping = false
  unsubscribeRecordingState?.()
  unsubscribeRecordingState = onRecordingStateChange(assistedStop.recordingStateChanged)
  startNativeObserver()
}

export function stopMeetingPresence(): void {
  stopping = true
  observer?.kill()
  observer = null
  if (observerRestartTimer) clearTimeout(observerRestartTimer)
  observerRestartTimer = null
  unsubscribeRecordingState?.()
  unsubscribeRecordingState = null
  clearPresenceSignals()
  assistedStop.reset()
}

function receiveSnapshot(line: string): void {
  try {
    applySnapshot(JSON.parse(line) as MeetingSnapshot)
  } catch (error) {
    console.warn(`Meeting observer returned invalid data: ${String(error)}`)
  }
}

function applySnapshot(snapshot: MeetingSnapshot): void {
  if (!snapshot || !Array.isArray(snapshot.meetings)) return
  const meetings = snapshot.meetings.filter(validSignal)
  const nextKeys = new Set(meetings.map((meeting) => meeting.key))
  logSnapshotChange(nextKeys, meetings)
  for (const key of activeSignals.keys()) if (!nextKeys.has(key)) removeSignal(key)
  for (const meeting of meetings) acceptSignal(meeting)
}

function logSnapshotChange(nextKeys: Set<string>, meetings: MeetingSignal[]): void {
  if (!process.env[DEV_SERVER_ENV]) return
  const previous = [...activeSignals.keys()].sort().join(',')
  const next = [...nextKeys].sort().join(',')
  if (previous === next) return
  const activity = meetings.map((meeting) => meeting.title).join(', ') || 'none'
  console.info(`[meeting-presence] Supported microphone activity: ${activity}`)
}

function acceptSignal(signal: MeetingSignal): void {
  activeSignals.set(signal.key, signal)
  assistedStop.signalFound(signal.key)
  if (promptedKeys.has(signal.key) || debounceTimers.has(signal.key)) return
  debounceTimers.set(signal.key, setTimeout(() => promptForSignal(signal.key), DEBOUNCE_MS))
}

function validSignal(signal: MeetingSignal): boolean {
  if (!signal || !SUPPORTED_PROVIDERS.has(signal.provider)) return false
  return validField(signal.key) && validField(signal.title)
}

function validField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SIGNAL_FIELD_LENGTH
}

function removeSignal(key: string): void {
  activeSignals.delete(key)
  promptedKeys.delete(key)
  dismissMeetingPrompt(key)
  const timer = debounceTimers.get(key)
  if (timer) clearTimeout(timer)
  debounceTimers.delete(key)
  assistedStop.signalLost(key)
}

function promptForSignal(key: string): void {
  debounceTimers.delete(key)
  const signal = activeSignals.get(key)
  if (!signal) return
  promptedKeys.add(key)
  if (!canStartRecordingStatus(getRecordingState().status)) return
  showMeetingPrompt({ key: signal.key, title: signal.title, onRecord: () => void recordSignal(signal) })
}

async function recordSignal(signal: MeetingSignal): Promise<void> {
  try {
    const state = await startMeetingRecordingWorkflow({ title: signal.title })
    assistedStop.track({ key: signal.key, title: signal.title, meetingId: state.meetingId })
  } catch (error) {
    showApp()
    console.error(`Start recording for ${signal.provider} failed:`, error)
  }
}

function startNativeObserver(): void {
  if (process.platform !== 'darwin' || stopping) return
  const child = spawn(resolveCaptureBinary(), ['--observe-meetings'], { env: childEnv() })
  observer = child
  readline.createInterface({ input: child.stdout }).on('line', receiveSnapshot)
  child.stderr.on('data', (data) => console.warn(`Meeting observer warning: ${String(data).trim()}`))
  child.once('error', (error) => observerFailed(child, error))
  child.once('exit', () => restartNativeObserver(child))
}

function observerFailed(child: ChildProcessWithoutNullStreams, error: Error): void {
  console.warn(`Meeting observer failed to start: ${error.message}`)
  if (observer === child) clearPresenceSignals()
  assistedStop.observerUnavailable()
}

function restartNativeObserver(child: ChildProcessWithoutNullStreams): void {
  if (observer !== child) return
  observer = null
  clearPresenceSignals()
  assistedStop.observerUnavailable()
  if (!stopping) observerRestartTimer = setTimeout(startNativeObserver, OBSERVER_RESTART_MS)
}

function clearPresenceSignals(): void {
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  activeSignals.clear()
  promptedKeys.clear()
  stopMeetingPrompts()
}
