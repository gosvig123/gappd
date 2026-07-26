import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Device, RecordingState } from '../../shared/contracts'
import { canStartRecordingStatus, canStopRecordingStatus, recordingRefreshTarget, RECORDING_STATUS_IDLE } from '../../shared/meeting-recording-workflow'
import { DEFAULT_TRANSCRIPTION_LANGUAGE, TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'
import { permissionTarget } from '../components/meeting-status'
import { useGuardedEffect } from './use-guarded-effect'

const MEDIA_DEVICE_CHANGE_EVENT = 'devicechange'
const VISIBLE_DOCUMENT_STATE = 'visible'
const VISIBILITY_CHANGE_EVENT = 'visibilitychange'
const WINDOW_FOCUS_EVENT = 'focus'
const TRANSCRIPTION_LANGUAGE_STORAGE_KEY = 'gappd.transcriptionLanguage'

type RecordingWorkflowEffects = {
  refreshMeetings(preferredId?: string | null): Promise<void>
  setError(error: string | null): void
}

type RecordingWorkflowState = {
  devices: Device[]
  device: number
  language: string
  recording: RecordingState
  recoveringStale: boolean
  staleRecoveryNotice: string | null
}

const INITIAL_RECORDING_WORKFLOW_STATE: RecordingWorkflowState = { devices: [], device: 0, language: savedTranscriptionLanguage(), recording: { status: RECORDING_STATUS_IDLE }, recoveringStale: false, staleRecoveryNotice: null }

export function useMeetingRecordingWorkflow(enabled: boolean, effects: RecordingWorkflowEffects) {
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const [state, setState] = useState<RecordingWorkflowState>(INITIAL_RECORDING_WORKFLOW_STATE)
  const actions = useRecordingActions(state.device, state.language, setState, effectsRef)

  useRecordingLifecycle(enabled, effectsRef, setState)
  useDeviceRefreshLifecycle(enabled, setState, effectsRef)

  const canStart = state.devices.length > 0 && canStartRecordingStatus(state.recording.status)
  const canStop = canStopRecordingStatus(state.recording.status)
  return { ...state, canStart, canStop, actions }
}

function useRecordingActions(device: number, language: string, setState: SetRecordingWorkflowState, effects: EffectsRef) {
  return useMemo(() => ({
    start: () => startRecording(device, language, setState, effects.current.setError),
    stop: () => stopRecording(setState, effects.current.setError),
    setDevice: (next: number) => setState((current) => ({ ...current, device: next })),
    setLanguage: (next: string) => setLanguage(next, setState),
    openPermissionsSettings: (error: string | null) => openPermissionsSettings(error, effects.current.setError),
  }), [device, language, effects, setState])
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
  const target = recordingRefreshTarget(next)
  if (target !== undefined) await effects.refreshMeetings(target)
}

async function startRecording(device: number, language: string, setState: SetRecordingWorkflowState, setError: (error: string | null) => void) {
  try {
    setError(null)
    const { speakerLabelsEnabled } = await window.gappd.startup.getSettings()
    const recording = await window.gappd.recording.start({ device, language, speakerLabelsEnabled })
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

function reconcileDevices(state: RecordingWorkflowState, devices: Device[]): RecordingWorkflowState {
  const device = selectedDeviceIndex(devices, state.device)
  return { ...state, devices, device: device ?? state.device }
}

function selectedDeviceIndex(devices: Device[], currentDevice: number): number | null {
  if (!devices.length) return null
  return devices.some((device) => device.index === currentDevice) ? currentDevice : devices[0].index
}

function recoveryNotice(recovered: number): string | null {
  if (recovered === 0) return null
  return recovered === 1 ? 'Recovered 1 previous recording.' : `Recovered ${recovered} previous recordings.`
}

function setLanguage(language: string, setState: SetRecordingWorkflowState) {
  const next = supportedLanguage(language)
  saveTranscriptionLanguage(next)
  setState((current) => ({ ...current, language: next }))
}

function savedTranscriptionLanguage(): string {
  try {
    return supportedLanguage(localStorage.getItem(TRANSCRIPTION_LANGUAGE_STORAGE_KEY) ?? '')
  } catch {
    return DEFAULT_TRANSCRIPTION_LANGUAGE
  }
}

function saveTranscriptionLanguage(language: string) {
  try {
    localStorage.setItem(TRANSCRIPTION_LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Ignore unavailable storage; current session state still applies.
  }
}

function supportedLanguage(language: string): string {
  return TRANSCRIPTION_LANGUAGES.some((item) => item.code === language) ? language : DEFAULT_TRANSCRIPTION_LANGUAGE
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
