import { useMemo, useRef, useState } from 'react'
import type { MeetingDetail, MeetingListItem } from '../../shared/contracts'
import { isPermissionErrorMessage } from '../components/meeting-status'
import { useDynamicRefresh } from './use-dynamic-refresh'
import { useGuardedEffect } from './use-guarded-effect'
import { useMeetingRecordingWorkflow } from './use-meeting-recording-workflow'
import { useRequestGate } from './request-gate'

export function useDashboardData(enabled: boolean) {
  const selectedMeetingRequest = useRequestGate()
  const refreshRequest = useRequestGate()
  const refs = useMeetingRefs()
  const [state, setState] = useDashboardState()

  const meetingActions = useDashboardActions(setState, refs, selectedMeetingRequest, refreshRequest)
  const recording = useDashboardRecording(enabled, meetingActions)
  const actions = useDashboardViewActions(meetingActions, recording, state)

  useMeetingsLifecycle(enabled, meetingActions, setState)
  useDynamicRefresh(enabled, state.meetings, recording.recording, () => refs.selectedId.current, meetingActions.refreshMeetings)

  return useMemo(() => buildDashboardViewModel(state, recording, actions), [state, recording, actions])
}

function useDashboardRecording(enabled: boolean, actions: MeetingActions) {
  return useMeetingRecordingWorkflow(enabled, {
    refreshMeetings: actions.refreshMeetings,
    setError: actions.setError,
  })
}

function useDashboardViewActions(actions: MeetingActions, recording: RecordingWorkflow, state: DashboardState): DashboardActions {
  return useMemo(() => ({
    ...actions,
    start: recording.actions.start,
    stop: recording.actions.stop,
    setDevice: recording.actions.setDevice,
    setLanguage: recording.actions.setLanguage,
    openPermissionsSettings: () => recording.actions.openPermissionsSettings(state.error ?? recording.recording.error ?? null),
  }), [actions, recording.actions, recording.recording.error, state.error])
}

function useMeetingRefs() {
  return { selectedId: useRef<string | null>(null), selected: useRef<MeetingDetail | null>(null) }
}

function useDashboardState() {
  return useState({
    meetings: [] as MeetingListItem[],
    selectedMeetingId: null as string | null,
    selectedMeeting: null as MeetingDetail | null,
    selectedMeetingLoading: false,
    selectedMeetingError: null as string | null,
    error: null as string | null,
  })
}

function useDashboardActions(setState: SetDashboardState, refs: MeetingRefs, selectedRequest: RequestGate, refreshRequest: RequestGate) {
  return {
    refreshMeetings: (id?: string | null) => refreshMeetings(id, refs, setState, selectedRequest, refreshRequest),
    loadMeeting: (id: string) => loadMeeting(id, refs, setState, selectedRequest),
    clearSelectedMeeting: () => clearSelectedMeeting(refs, setState),
    deleteMeeting: (id: string) => deleteMeeting(id, refs, setState, selectedRequest, refreshRequest),
    setError: (error: string | null) => setState((current) => ({ ...current, error })),
  }
}

async function refreshMeetings(preferredId: string | null | undefined, refs: MeetingRefs, setState: SetDashboardState, selectedRequest: RequestGate, refreshRequest: RequestGate) {
  const requestId = refreshRequest.next()
  const meetings = await window.gappd.meetings.list()
  if (!refreshRequest.isCurrent(requestId)) return
  setState((current) => ({ ...current, meetings }))
  await resolveSelectedMeeting(meetings, preferredId, refs, (id) => loadMeeting(id, refs, setState, selectedRequest), () => clearSelectedMeeting(refs, setState))
}

async function loadMeeting(id: string, refs: MeetingRefs, setState: SetDashboardState, selectedRequest: RequestGate) {
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

function clearSelectedMeeting(refs: MeetingRefs, setState: SetDashboardState) {
  refs.selectedId.current = null
  refs.selected.current = null
  setState((current) => ({ ...current, selectedMeetingId: null, selectedMeeting: null, selectedMeetingLoading: false, selectedMeetingError: null }))
}

async function deleteMeeting(id: string, refs: MeetingRefs, setState: SetDashboardState, selectedRequest: RequestGate, refreshRequest: RequestGate) {
  selectedRequest.cancel()
  beginMeetingDelete(id, setState)
  try {
    await finishMeetingDelete(id, refs, setState, selectedRequest, refreshRequest)
  } catch (err) {
    failMeetingDelete(err, setState)
  }
}

function beginMeetingDelete(id: string, setState: SetDashboardState) {
  setState((current) => ({ ...current, error: null, selectedMeetingLoading: current.selectedMeetingId === id || current.selectedMeetingLoading }))
}

async function finishMeetingDelete(id: string, refs: MeetingRefs, setState: SetDashboardState, selectedRequest: RequestGate, refreshRequest: RequestGate) {
  const result = await window.gappd.meetings.delete(id)
  if (refs.selectedId.current === id) refs.selectedId.current = null
  await refreshMeetings(null, refs, setState, selectedRequest, refreshRequest)
  if (result.artifactWarning) setState((current) => ({ ...current, error: result.artifactWarning ?? null }))
}

function failMeetingDelete(err: unknown, setState: SetDashboardState) {
  setDashboardError(err, setState)
  setState((current) => ({ ...current, selectedMeetingLoading: false }))
}

type MeetingActions = ReturnType<typeof useDashboardActions>
type DashboardActions = MeetingActions & {
  start(): void
  stop(): void
  setDevice(device: number): void
  setLanguage(language: string): void
  openPermissionsSettings(): void
}
type DashboardState = ReturnType<typeof useDashboardState>[0]
type RecordingWorkflow = ReturnType<typeof useMeetingRecordingWorkflow>
type SetDashboardState = ReturnType<typeof useDashboardState>[1]
type MeetingRefs = ReturnType<typeof useMeetingRefs>
type RequestGate = ReturnType<typeof useRequestGate>

async function resolveSelectedMeeting(meetings: MeetingListItem[], preferredId: string | null | undefined, refs: MeetingRefs, loadMeeting: (id: string) => Promise<void>, clear: () => void) {
  const nextId = preferredId ?? refs.selectedId.current ?? null
  if (!nextId) return clear()
  // Don't fall back to the first meeting — if the open one is gone, return to the list.
  const resolvedId = meetings.some((meeting) => meeting.id === nextId) ? nextId : null
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

function useMeetingsLifecycle(enabled: boolean, actions: MeetingActions, setState: SetDashboardState) {
  useGuardedEffect((guard) => {
    if (!enabled) return undefined
    void actions.refreshMeetings().catch((err) => guard(() => setDashboardError(err, setState)))
    return undefined
  }, [enabled])
}

function buildDashboardViewModel(state: DashboardState, recording: RecordingWorkflow, actions: DashboardActions) {
  const bannerError = state.error ?? recording.recording.error ?? null
  return {
    ...state,
    devices: recording.devices,
    device: recording.device,
    language: recording.language,
    recording: recording.recording,
    recoveringStale: recording.recoveringStale,
    staleRecoveryNotice: recording.staleRecoveryNotice,
    canStart: recording.canStart,
    canStop: recording.canStop,
    bannerError,
    transcript: state.selectedMeeting?.transcriptText ?? '',
    isPermissionError: isPermissionErrorMessage(bannerError),
    actions,
  }
}

function setDashboardError(err: unknown, setState: SetDashboardState) {
  setState((current) => ({ ...current, error: errorMessage(err) }))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
