import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Device, RecordingState } from '../../shared/contracts'
import { permissionTarget } from '../components/meeting-status'
import { useGuardedEffect } from './use-guarded-effect'

const IDLE_RECORDING_STATUS: RecordingState['status'] = 'idle'
const ERROR_RECORDING_STATUS: RecordingState['status'] = 'error'
const RECORDING_RECORDING_STATUS: RecordingState['status'] = 'recording'
const STARTABLE_RECORDING_STATUSES: RecordingState['status'][] = [IDLE_RECORDING_STATUS, ERROR_RECORDING_STATUS]
const STOPPABLE_RECORDING_STATUSES: RecordingState['status'][] = [RECORDING_RECORDING_STATUS]
const MEDIA_DEVICE_CHANGE_EVENT = 'devicechange'
const NO_INPUT_DEVICE_ERROR = 'Connect or enable input device before recording.'
const VISIBLE_DOCUMENT_STATE = 'visible'
const VISIBILITY_CHANGE_EVENT = 'visibilitychange'
const WINDOW_FOCUS_EVENT = 'focus'

type RecordingWorkflowEffects = {
  refreshMeetings(preferredId?: string | null): Promise<void>
  setError(error: string | null): void
}

type RecordingWorkflowState = {
  devices: Device[]
  device: number
  recording: RecordingState
  recoveringStale: boolean
  staleRecoveryNotice: string | null
}

const INITIAL_RECORDING_WORKFLOW_STATE: RecordingWorkflowState = { devices: [], device: 0, recording: { status: IDLE_RECORDING_STATUS }, recoveringStale: false, staleRecoveryNotice: null }

export function useMeetingRecordingWorkflow(enabled: boolean, effects: RecordingWorkflowEffects) {
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const [state, setState] = useState<RecordingWorkflowState>(INITIAL_RECORDING_WORKFLOW_STATE)
  const actions = useRecordingActions(state.device, setState, effectsRef)

  useRecordingLifecycle(enabled, effectsRef, setState)
  useDeviceRefreshLifecycle(enabled, setState, effectsRef)

  const canStart = state.devices.length > 0 && STARTABLE_RECORDING_STATUSES.includes(state.recording.status)
  const canStop = STOPPABLE_RECORDING_STATUSES.includes(state.recording.status)
  return { ...state, canStart, canStop, actions }
}

function useRecordingActions(device: number, setState: SetRecordingWorkflowState, effects: EffectsRef) {
  return useMemo(() => ({
    start: () => startRecording(device, setState, effects.current.setError),
    stop: () => stopRecording(setState, effects.current.setError),
    setDevice: (next: number) => setState((current) => ({ ...current, device: next })),
    openPermissionsSettings: (error: string | null) => openPermissionsSettings(error, effects.current.setError),
  }), [device, effects, setState])
}

type SetRecordingWorkflowState = Dispatch<SetStateAction<RecordingWorkflowState>>
type EffectsRef = MutableRefObject<RecordingWorkflowEffects>

function useRecordingLifecycle(enabled: boolean, effects: EffectsRef, setState: SetRecordingWorkflowState) {
  useGuardedEffect((guard) => {
    if (!enabled) return undefined
    const dispose = window.gappd.recording.onStatusChanged((next) => guard(() => void handleRecordingChange(next, effects.current, setState)))
    void loadReadyRecordingData(effects, setState).catch((err) => guard(() => effects.current.setError(errorMessage(err))))
    return dispose
  }, [enabled])
}

function useDeviceRefreshLifecycle(enabled: boolean, setState: SetRecordingWorkflowState, effects: EffectsRef) {
  useGuardedEffect((guard) => {
    if (!enabled) return undefined
    const refresh = () => void refreshDevices(setState).catch((err) => guard(() => effects.current.setError(errorMessage(err))))
    const refreshWhenVisible = () => { if (document.visibilityState === VISIBLE_DOCUMENT_STATE) refresh() }
    const mediaDevices = navigator.mediaDevices
    window.addEventListener(WINDOW_FOCUS_EVENT, refresh)
    document.addEventListener(VISIBILITY_CHANGE_EVENT, refreshWhenVisible)
    mediaDevices?.addEventListener(MEDIA_DEVICE_CHANGE_EVENT, refresh)
    return () => {
      window.removeEventListener(WINDOW_FOCUS_EVENT, refresh)
      document.removeEventListener(VISIBILITY_CHANGE_EVENT, refreshWhenVisible)
      mediaDevices?.removeEventListener(MEDIA_DEVICE_CHANGE_EVENT, refresh)
    }
  }, [enabled])
}

async function loadReadyRecordingData(effects: EffectsRef, setState: SetRecordingWorkflowState) {
  const [devices, recording] = await Promise.all([window.gappd.system.getDevices(), window.gappd.recording.getStatus()])
  setState((current) => ({ ...reconcileDevices(current, devices), recording }))
  await recoverStaleRecordings(effects, setState)
}

async function recoverStaleRecordings(effects: EffectsRef, setState: SetRecordingWorkflowState) {
  setState((current) => ({ ...current, recoveringStale: true, staleRecoveryNotice: null }))
  try {
    const recovered = await window.gappd.system.startStaleRecordingRecovery()
    if (recovered > 0) await effects.current.refreshMeetings()
    setState((current) => ({ ...current, recoveringStale: false, staleRecoveryNotice: recoveryNotice(recovered) }))
  } catch (err) {
    setState((current) => ({ ...current, recoveringStale: false }))
    throw err
  }
}

async function handleRecordingChange(next: RecordingState, effects: RecordingWorkflowEffects, setState: SetRecordingWorkflowState) {
  setState((current) => ({ ...current, recording: next }))
  if (next.meetingId) return effects.refreshMeetings(next.meetingId)
  if (STARTABLE_RECORDING_STATUSES.includes(next.status)) await effects.refreshMeetings()
}

async function startRecording(device: number, setState: SetRecordingWorkflowState, setError: (error: string | null) => void) {
  try {
    setError(null)
    const selectedDevice = selectedDeviceIndex(await refreshDevices(setState), device)
    if (selectedDevice === null) return setError(NO_INPUT_DEVICE_ERROR)
    const permissionError = capturePermissionError(await window.gappd.system.requestCapturePermissions())
    if (permissionError) return setError(permissionError)
    const recording = await recordingStartInput(selectedDevice)
    setState((current) => ({ ...current, recording }))
  } catch (err) {
    setError(errorMessage(err))
  }
}

async function stopRecording(setState: SetRecordingWorkflowState, setError: (error: string | null) => void) {
  try {
    setError(null)
    const recording = await window.gappd.recording.stop()
    setState((current) => ({ ...current, recording }))
  } catch (err) {
    setError(errorMessage(err))
  }
}

async function openPermissionsSettings(error: string | null, setError: (error: string | null) => void) {
  try {
    await window.gappd.system.openPermissionsSettings(await permissionSettingsTarget(error))
  } catch (err) {
    setError(errorMessage(err))
  }
}

async function permissionSettingsTarget(error: string | null) {
  const permissions = await window.gappd.system.requestCapturePermissions()
  if (permissions.screen !== 'granted') return 'screen-recording'
  if (permissions.microphone !== 'granted') return 'microphone'
  return permissionTarget(error)
}

async function refreshDevices(setState: SetRecordingWorkflowState): Promise<Device[]> {
  const devices = await window.gappd.system.getDevices()
  setState((current) => reconcileDevices(current, devices))
  return devices
}

async function recordingStartInput(device: number): Promise<RecordingState> {
  const title = new Date().toLocaleString()
  return window.gappd.recording.start({ title, device, mode: 'both' })
}

function capturePermissionError(permissions: Awaited<ReturnType<typeof window.gappd.system.requestCapturePermissions>>): string | null {
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

function reconcileDevices(state: RecordingWorkflowState, devices: Device[]): RecordingWorkflowState {
  const device = selectedDeviceIndex(devices, state.device)
  return { ...state, devices, device: device ?? state.device }
}

function selectedDeviceIndex(devices: Device[], currentDevice: number): number | null {
  if (!devices.length) return null
  return devices.some((device) => device.index === currentDevice) ? currentDevice : devices[0].index
}

function isPermissionDeniedState(state: string): boolean {
  const normalized = state.trim().toLowerCase()
  return normalized.includes('denied') || normalized.includes('restricted')
}

function recoveryNotice(recovered: number): string | null {
  if (recovered === 0) return null
  return recovered === 1 ? 'Recovered 1 previous recording.' : `Recovered ${recovered} previous recordings.`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
