import type { Device, RecordingState } from '../shared/contracts'
import type { StartRecordingInput } from '../shared/ipc-contract'
import { getDevices, requestCapturePermissions, startRecording, startStaleRecordingRecovery, stopRecording } from './gappd'
import { getRecordingState } from './state'

const DEFAULT_CAPTURE_MODE = 'both'
const NO_INPUT_DEVICE_ERROR = 'Connect or enable input device before recording.'

export async function startMeetingRecordingWorkflow(input: StartRecordingInput = {}): Promise<RecordingState> {
  const selectedDevice = selectedDeviceIndex(await getDevices(), input.device)
  if (selectedDevice === null) throw new Error(NO_INPUT_DEVICE_ERROR)
  const permissionError = capturePermissionError(await requestCapturePermissions())
  if (permissionError) throw new Error(permissionError)
  await startRecording({ title: recordingTitle(input.title), device: selectedDevice, mode: input.mode ?? DEFAULT_CAPTURE_MODE })
  return getRecordingState()
}

export function stopMeetingRecordingWorkflow(): RecordingState {
  stopRecording()
  return getRecordingState()
}

export async function startStaleMeetingRecordingRecovery(): Promise<number> {
  return startStaleRecordingRecovery()
}

function selectedDeviceIndex(devices: Device[], requested?: number): number | null {
  if (!devices.length) return null
  if (requested === undefined) return devices[0].index
  return devices.some((device) => device.index === requested) ? requested : devices[0].index
}

function recordingTitle(title?: string): string {
  const trimmed = title?.trim()
  return trimmed || new Date().toLocaleString()
}

function capturePermissionError(permissions: Awaited<ReturnType<typeof requestCapturePermissions>>): string | null {
  const microphoneDenied = isPermissionDeniedState(permissions.microphone)
  const screenDenied = isPermissionDeniedState(permissions.screen)
  const microphoneGranted = permissions.microphone === 'granted'
  const screenGranted = permissions.screen === 'granted'
  if ((!microphoneGranted && !microphoneDenied) || (!screenGranted && !screenDenied)) return 'Could not confirm microphone and screen/system audio permissions. Try again, then check System Settings if the problem continues.'
  if (microphoneDenied && screenDenied) return 'Microphone and Screen & System Audio Recording access denied. Enable GappdCapture in System Settings to record.'
  if (microphoneDenied) return 'Microphone access denied. Enable GappdCapture in System Settings to record.'
  if (screenDenied) return 'Screen & System Audio Recording access required. Enable GappdCapture in System Settings to capture system audio.'
  return null
}

function isPermissionDeniedState(state: string): boolean {
  const normalized = state.trim().toLowerCase()
  return normalized.includes('denied') || normalized.includes('restricted')
}
