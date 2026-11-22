import type { Device, RecordingState } from '../shared/contracts'
import type { StartRecordingInput } from '../shared/ipc-contract'
import { canStartRecordingStatus, RECORDING_STATUS_IDLE, RECORDING_STATUS_STARTING } from '../shared/meeting-recording-workflow'
import { calendarMeetingTitle, genericMeetingTitle } from '../shared/meeting-title'
import { DEFAULT_TRANSCRIPTION_LANGUAGE } from '../shared/transcription-languages'
import { requestCapturePermissions } from './capture-permissions'
import { pauseDrains, resumeDrains } from './drain-coordinator'
import { codedError, type CodedError } from './error-log'
import { getDevices } from './meetings'
import { isRecordingProcessRunning, startRecording, stopRecording } from './recording-process'
import { getRecordingState, setRecordingState } from './state'
import { getStartupSettings } from './startup-settings'
import { recordingCalendarContext, rememberRecordingCalendar } from './participant-calendar'

const DEFAULT_CAPTURE_MODE = 'both'
const NO_INPUT_DEVICE_ERROR = 'Connect or enable input device before recording.'
const QUIT_START_WAIT_MS = 2_000
let startingWorkflow: Promise<RecordingState> | null = null
let shuttingDown = false

/** Marks shutdown synchronously before other quit awaits so an in-flight start cannot spawn a recorder. */
export function beginRecordingShutdown(): void {
  shuttingDown = true
}

/** Prevents an in-flight start from spawning a recorder during app quit and waits briefly for it to settle. */
export async function stopStartingRecordingForQuit(): Promise<void> {
  shuttingDown = true
  const pending = startingWorkflow
  if (!pending) return
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    pending.catch(() => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, QUIT_START_WAIT_MS) }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

/** fallbackTitle names the Meeting when it has no title and no Calendar event, such as "Zoom call". */
export type RecordingWorkflowInput = StartRecordingInput & { fallbackTitle?: string; onStarted?: (meetingId: string) => void }

export async function startMeetingRecordingWorkflow(input: RecordingWorkflowInput = {}): Promise<RecordingState> {
  if (shuttingDown) throw codedError('Gappd is closing.', 'APP_SHUTTING_DOWN', { expected: true })
  if (startingWorkflow) return startingWorkflow
  const current = getRecordingState()
  if (current.status === RECORDING_STATUS_STARTING) return current
  if (isRecordingProcessRunning() || !canStartRecordingStatus(current.status)) {
    throw codedError('A recording is already running.', 'RECORDING_ALREADY_RUNNING', { expected: true })
  }
  const title = input.title?.trim()
  setRecordingState({ status: RECORDING_STATUS_STARTING, title: title || input.fallbackTitle?.trim() })
  const pending = runStartMeetingRecordingWorkflow(input, title).finally(() => {
    if (startingWorkflow === pending) startingWorkflow = null
  })
  startingWorkflow = pending
  return pending
}

async function runStartMeetingRecordingWorkflow(input: RecordingWorkflowInput, title?: string): Promise<RecordingState> {
  let drainsPaused = false
  try {
    const selectedDevice = selectedDeviceIndex(await getDevices(), input.device)
    if (selectedDevice === null) throw codedError(NO_INPUT_DEVICE_ERROR, 'NO_INPUT_DEVICE', { expected: true })
    const permissionError = capturePermissionError(await requestCapturePermissions())
    if (permissionError) throw permissionError
    const calendar = await prepareCalendar(input.eventSourceId, !title)
    if (shuttingDown) throw codedError('Gappd is closing.', 'APP_SHUTTING_DOWN', { expected: true })
    await pauseDrains('recording')
    drainsPaused = true
    if (shuttingDown) throw codedError('Gappd is closing.', 'APP_SHUTTING_DOWN', { expected: true })
    await startRecording({ ...recordingTitle(title, calendar?.event?.title, input.fallbackTitle), device: selectedDevice, mode: input.mode ?? DEFAULT_CAPTURE_MODE,
      language: recordingLanguage(input.language), speakerLabelsEnabled: input.speakerLabelsEnabled ?? getStartupSettings().speakerLabelsEnabled,
      screenVideoEnabled: getStartupSettings().screenVideoEnabled },
    (id) => {
      input.onStarted?.(id)
      if (calendar) void rememberRecordingCalendar(id, calendar).catch((error) => console.warn('Save recording calendar context:', error))
    })
    return getRecordingState()
  } catch (error) {
    if (drainsPaused) resumeDrains('recording')
    if (getRecordingState().status === RECORDING_STATUS_STARTING) setRecordingState({ status: RECORDING_STATUS_IDLE })
    throw error
  }
}

async function prepareCalendar(eventSourceId: string | undefined, pickCurrent: boolean) {
  try { return await recordingCalendarContext(eventSourceId, pickCurrent) }
  catch (error) {
    if (eventSourceId) throw error
    console.warn('Read optional recording calendar context:', error)
    return undefined
  }
}

export function stopMeetingRecordingWorkflow(): RecordingState {
  stopRecording()
  return getRecordingState()
}

function selectedDeviceIndex(devices: Device[], requested?: number): number | null {
  if (!devices.length) return null
  if (requested === undefined) return devices[0].index
  return devices.some((device) => device.index === requested) ? requested : devices[0].index
}

/** A title the caller chose wins; then the Calendar event's title, which the AI title never replaces. */
function recordingTitle(title?: string, eventTitle?: string, fallbackTitle?: string): { title: string; titleSource?: 'calendar' } {
  if (title) return { title }
  const calendarTitle = calendarMeetingTitle(eventTitle)
  if (calendarTitle) return { title: calendarTitle, titleSource: 'calendar' }
  return { title: fallbackTitle?.trim() || genericMeetingTitle(new Date()) }
}

/** The language chosen in the record bar. A recording started outside the window, from the meeting prompt, uses it too. */
let preferredLanguage = DEFAULT_TRANSCRIPTION_LANGUAGE

export function setPreferredRecordingLanguage(language: string): void {
  preferredLanguage = language.trim() || DEFAULT_TRANSCRIPTION_LANGUAGE
}

function recordingLanguage(language?: string): string {
  return language?.trim() || preferredLanguage
}

function capturePermissionError(permissions: Awaited<ReturnType<typeof requestCapturePermissions>>): CodedError | null {
  const microphoneDenied = isPermissionDeniedState(permissions.microphone)
  const screenDenied = isPermissionDeniedState(permissions.screen)
  const microphoneGranted = permissions.microphone === 'granted'
  const screenGranted = permissions.screen === 'granted'
  if ((!microphoneGranted && !microphoneDenied) || (!screenGranted && !screenDenied)) {
    return codedError('Could not confirm microphone and screen/system audio permissions. Try again, then check System Settings if the problem continues.', 'PERMISSION_CHECK_UNKNOWN')
  }
  if (microphoneDenied && screenDenied) {
    return codedError('Microphone and Screen & System Audio Recording access denied. Enable Gappd in System Settings to record.', 'PERMISSION_DENIED_BOTH', { expected: true })
  }
  if (microphoneDenied) {
    return codedError('Microphone access denied. Enable Gappd in System Settings to record.', 'PERMISSION_DENIED_MIC', { expected: true })
  }
  if (screenDenied) {
    return codedError('Screen & System Audio Recording access required. Enable Gappd in System Settings to capture system audio.', 'PERMISSION_DENIED_SCREEN', { expected: true })
  }
  return null
}

function isPermissionDeniedState(state: string): boolean {
  const normalized = state.trim().toLowerCase()
  return normalized.includes('denied') || normalized.includes('restricted')
}
