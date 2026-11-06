import type { Device, RecordingState } from '../shared/contracts'
import type { StartRecordingInput } from '../shared/ipc-contract'
import { calendarMeetingTitle, genericMeetingTitle } from '../shared/meeting-title'
import { DEFAULT_TRANSCRIPTION_LANGUAGE } from '../shared/transcription-languages'
import { requestCapturePermissions } from './capture-permissions'
import { pauseDrains, resumeDrains } from './drain-coordinator'
import { getDevices } from './meetings'
import { startRecording, stopRecording } from './recording-process'
import { getRecordingState } from './state'
import { getStartupSettings } from './startup-settings'
import { recordingCalendarContext, rememberRecordingCalendar } from './participant-calendar'

const DEFAULT_CAPTURE_MODE = 'both'
const NO_INPUT_DEVICE_ERROR = 'Connect or enable input device before recording.'

/** fallbackTitle names the Meeting when it has no title and no Calendar event, such as "Zoom call". */
export type RecordingWorkflowInput = StartRecordingInput & { fallbackTitle?: string }

export async function startMeetingRecordingWorkflow(input: RecordingWorkflowInput = {}): Promise<RecordingState> {
  const selectedDevice = selectedDeviceIndex(await getDevices(), input.device)
  if (selectedDevice === null) throw new Error(NO_INPUT_DEVICE_ERROR)
  const permissionError = capturePermissionError(await requestCapturePermissions())
  if (permissionError) throw new Error(permissionError)
  const title = input.title?.trim()
  const calendar = await prepareCalendar(input.eventSourceId, !title)
  await pauseDrains('recording')
  try {
    await startRecording({ ...recordingTitle(title, calendar?.event?.title, input.fallbackTitle), device: selectedDevice, mode: input.mode ?? DEFAULT_CAPTURE_MODE,
      language: recordingLanguage(input.language), speakerLabelsEnabled: input.speakerLabelsEnabled ?? getStartupSettings().speakerLabelsEnabled,
      screenVideoEnabled: getStartupSettings().screenVideoEnabled },
    (id) => { if (calendar) void rememberRecordingCalendar(id, calendar).catch((error) => console.warn('Save recording calendar context:', error)) })
    return getRecordingState()
  } catch (error) {
    resumeDrains('recording')
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

function recordingLanguage(language?: string): string {
  return language?.trim() || DEFAULT_TRANSCRIPTION_LANGUAGE
}

function capturePermissionError(permissions: Awaited<ReturnType<typeof requestCapturePermissions>>): string | null {
  const microphoneDenied = isPermissionDeniedState(permissions.microphone)
  const screenDenied = isPermissionDeniedState(permissions.screen)
  const microphoneGranted = permissions.microphone === 'granted'
  const screenGranted = permissions.screen === 'granted'
  if ((!microphoneGranted && !microphoneDenied) || (!screenGranted && !screenDenied)) return 'Could not confirm microphone and screen/system audio permissions. Try again, then check System Settings if the problem continues.'
  if (microphoneDenied && screenDenied) return 'Microphone and Screen & System Audio Recording access denied. Enable Gappd in System Settings to record.'
  if (microphoneDenied) return 'Microphone access denied. Enable Gappd in System Settings to record.'
  if (screenDenied) return 'Screen & System Audio Recording access required. Enable Gappd in System Settings to capture system audio.'
  return null
}

function isPermissionDeniedState(state: string): boolean {
  const normalized = state.trim().toLowerCase()
  return normalized.includes('denied') || normalized.includes('restricted')
}
