import { useMemo, useRef, useState } from 'react'
import type { Device, MeetingDetail, MeetingListItem, RecordingState } from '../../shared/contracts'
import { isPermissionErrorMessage, permissionTarget } from '../components/meeting-status'
import { ACTIVE_RECORDING_STATUSES, useDynamicRefresh } from './use-dynamic-refresh'
import { useGuardedEffect } from './use-guarded-effect'
import { useRequestGate } from './request-gate'

const IDLE_RECORDING_STATUS: RecordingState['status'] = 'idle'
const ERROR_RECORDING_STATUS: RecordingState['status'] = 'error'
const STARTABLE_RECORDING_STATUSES: RecordingState['status'][] = [IDLE_RECORDING_STATUS, ERROR_RECORDING_STATUS]

export function useDashboardData(enabled: boolean) {
  const selectedMeetingRequest = useRequestGate()
  const refreshRequest = useRequestGate()
  const refs = useMeetingRefs()
  const [state, setState] = useDashboardState()

  const actions = useDashboardActions(state, setState, refs, selectedMeetingRequest, refreshRequest)
  useRecordingLifecycle(enabled, refs, actions, setState)
  useDynamicRefresh(enabled, state.meetings, state.recording, () => refs.selectedId.current, actions.refreshMeetings)

  return useMemo(() => buildDashboardViewModel(state, actions), [state, actions])
}

function useMeetingRefs() {
  return { selectedId: useRef<string | null>(null), selected: useRef<MeetingDetail | null>(null) }
}

function useDashboardState() {
  return useState({
    devices: [] as Device[],
    meetings: [] as MeetingListItem[],
    selectedMeetingId: null as string | null,
    selectedMeeting: null as MeetingDetail | null,
    selectedMeetingLoading: false,
    selectedMeetingError: null as string | null,
    recording: { status: IDLE_RECORDING_STATUS } as RecordingState,
    error: null as string | null,
    device: 0,
  })
}

function useDashboardActions(state: DashboardState, setState: SetDashboardState, refs: MeetingRefs, selectedRequest: RequestGate, refreshRequest: RequestGate) {
  async function refreshMeetings(preferredId?: string | null) {
    const requestId = refreshRequest.next()
    const meetings = await window.gappd.meetings.list()
    if (!refreshRequest.isCurrent(requestId)) return
    setState((current) => ({ ...current, meetings }))
    await resolveSelectedMeeting(meetings, preferredId, refs, loadMeeting, clearSelectedMeeting)
  }

  async function loadMeeting(id: string) {
    const requestId = selectedRequest.next()
    startMeetingLoad(id, setState, refs)
    try {
      const meeting = await window.gappd.meetings.show(id)
      if (isCurrentMeeting(requestId, id, refs, selectedRequest)) applySelectedMeeting(meeting, setState, refs)
    } catch (err) {
      if (isCurrentMeeting(requestId, id, refs, selectedRequest)) failSelectedMeeting(err, setState, refs)
    } finally {
      if (isCurrentMeeting(requestId, id, refs, selectedRequest)) setState((current) => ({ ...current, selectedMeetingLoading: false }))
    }
  }

  function clearSelectedMeeting() {
    refs.selectedId.current = null
    refs.selected.current = null
    setState((current) => ({ ...current, selectedMeetingId: null, selectedMeeting: null, selectedMeetingLoading: false, selectedMeetingError: null }))
  }

  async function loadAppData() {
    const [devices, meetings, recording] = await Promise.all([window.gappd.system.getDevices(), window.gappd.meetings.list(), window.gappd.recording.getStatus()])
    setState((current) => ({ ...current, devices, meetings, recording, device: devices[0]?.index ?? current.device }))
    const initialMeetingId = recording.meetingId ?? meetings[0]?.id ?? null
    if (initialMeetingId) await loadMeeting(initialMeetingId)
    if (!initialMeetingId) clearSelectedMeeting()
  }

  return { refreshMeetings, loadMeeting, loadAppData, start: () => startRecording(state, setState), stop: () => stopRecording(setState), openPermissionsSettings: () => openPermissionsSettings(state, setState), setDevice: (device: number) => setState((current) => ({ ...current, device })), setError: (error: string) => setState((current) => ({ ...current, error })) }
}

type DashboardActions = ReturnType<typeof useDashboardActions>
type DashboardState = ReturnType<typeof useDashboardState>[0]
type SetDashboardState = ReturnType<typeof useDashboardState>[1]
type MeetingRefs = ReturnType<typeof useMeetingRefs>
type RequestGate = ReturnType<typeof useRequestGate>

async function resolveSelectedMeeting(meetings: MeetingListItem[], preferredId: string | null | undefined, refs: MeetingRefs, loadMeeting: (id: string) => Promise<void>, clear: () => void) {
  const nextId = preferredId ?? refs.selectedId.current ?? meetings[0]?.id ?? null
  if (!nextId) return clear()
  const resolvedId = meetings.some((meeting) => meeting.id === nextId) ? nextId : meetings[0]?.id ?? null
  if (resolvedId) await loadMeeting(resolvedId)
  if (!resolvedId) clear()
}

function startMeetingLoad(id: string, setState: SetDashboardState, refs: MeetingRefs) {
  const showLoading = refs.selected.current?.id !== id
  refs.selectedId.current = id
  if (showLoading) refs.selected.current = null
  // current.selectedMeeting, not a captured `state`: this runs from the
  // long-lived refresh interval, whose closure state can be many renders old.
  setState((current) => ({ ...current, selectedMeetingId: id, selectedMeeting: showLoading ? null : current.selectedMeeting, selectedMeetingLoading: showLoading, selectedMeetingError: null }))
}

function isCurrentMeeting(requestId: number, meetingId: string, refs: MeetingRefs, request: RequestGate): boolean {
  return request.isCurrent(requestId) && refs.selectedId.current === meetingId
}

function applySelectedMeeting(meeting: MeetingDetail, setState: SetDashboardState, refs: MeetingRefs) {
  refs.selected.current = meeting
  setState((current) => ({ ...current, selectedMeeting: meeting }))
}

function failSelectedMeeting(err: unknown, setState: SetDashboardState, refs: MeetingRefs) {
  refs.selected.current = null
  setState((current) => ({ ...current, selectedMeeting: null, selectedMeetingError: errorMessage(err) }))
}

function useRecordingLifecycle(enabled: boolean, refs: MeetingRefs, actions: DashboardActions, setState: SetDashboardState) {
  useGuardedEffect((guard) => {
    if (!enabled) return undefined
    const dispose = window.gappd.recording.onStatusChanged((next) => guard(() => void handleRecordingChange(next, refs, actions, setState)))
    void actions.loadAppData().catch((err) => guard(() => setDashboardError(err, setState)))
    return dispose
  }, [enabled])
}

async function handleRecordingChange(next: RecordingState, refs: MeetingRefs, actions: DashboardActions, setState: SetDashboardState) {
  setState((current) => ({ ...current, recording: next }))
  const meetingId = next.meetingId ?? refs.selectedId.current
  if (next.meetingId) refs.selectedId.current = next.meetingId
  if (meetingId) return actions.refreshMeetings(meetingId)
  if (STARTABLE_RECORDING_STATUSES.includes(next.status)) await actions.refreshMeetings()
}

async function startRecording(state: DashboardState, setState: SetDashboardState) {
  try {
    setState((current) => ({ ...current, error: null }))
    const permissionError = capturePermissionError(await window.gappd.system.requestCapturePermissions())
    if (permissionError) return setState((current) => ({ ...current, error: permissionError }))
    const recording = await recordingStartInput(state)
    setState((current) => ({ ...current, recording }))
  } catch (err) {
    setDashboardError(err, setState)
  }
}

async function recordingStartInput(state: DashboardState): Promise<RecordingState> {
  const title = new Date().toLocaleString()
  return window.gappd.recording.start({ title, device: state.device, mode: 'both' })
}

async function stopRecording(setState: SetDashboardState) {
  try {
    setState((current) => ({ ...current, error: null }))
    const recording = await window.gappd.recording.stop()
    setState((current) => ({ ...current, recording }))
  } catch (err) {
    setDashboardError(err, setState)
  }
}

async function openPermissionsSettings(state: DashboardState, setState: SetDashboardState) {
  try {
    const target = await permissionSettingsTarget(state.error ?? state.recording.error ?? null)
    await window.gappd.system.openPermissionsSettings(target)
  } catch (err) {
    setDashboardError(err, setState)
  }
}

async function permissionSettingsTarget(error: string | null) {
  const permissions = await window.gappd.system.requestCapturePermissions()
  if (isPermissionDeniedState(permissions.microphone)) return 'microphone'
  if (isPermissionDeniedState(permissions.screen)) return 'screen-recording'
  return permissionTarget(error)
}

function capturePermissionError(permissions: Awaited<ReturnType<typeof window.gappd.system.requestCapturePermissions>>): string | null {
  const microphoneDenied = isPermissionDeniedState(permissions.microphone)
  const screenDenied = isPermissionDeniedState(permissions.screen)
  const microphoneGranted = permissions.microphone === 'granted'
  const screenGranted = permissions.screen === 'granted'
  if ((!microphoneGranted && !microphoneDenied) || (!screenGranted && !screenDenied)) return 'Could not confirm microphone and screen recording permissions. Try again, then check System Settings if the problem continues.'
  if (microphoneDenied && screenDenied) return 'Microphone and Screen Recording access denied. Enable GappdCapture in System Settings to record.'
  if (microphoneDenied) return 'Microphone access denied. Enable GappdCapture in System Settings to record.'
  if (screenDenied) return 'Screen Recording access required. Enable GappdCapture in System Settings to capture system audio.'
  return null
}

function isPermissionDeniedState(state: string): boolean {
  const normalized = state.trim().toLowerCase()
  return normalized.includes('denied') || normalized.includes('restricted')
}

function buildDashboardViewModel(state: DashboardState, actions: DashboardActions) {
  const canStart = state.devices.length > 0 && STARTABLE_RECORDING_STATUSES.includes(state.recording.status)
  const canStop = ACTIVE_RECORDING_STATUSES.includes(state.recording.status)
  const bannerError = state.error ?? state.recording.error ?? null
  return { ...state, canStart, canStop, bannerError, transcript: state.selectedMeeting?.transcriptText ?? '', isPermissionError: isPermissionErrorMessage(bannerError), actions }
}

function setDashboardError(err: unknown, setState: SetDashboardState) {
  setState((current) => ({ ...current, error: errorMessage(err) }))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
