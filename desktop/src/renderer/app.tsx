import { useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/app-header'
import { getLocalAIContract, toStatusError, type LocalAIStatus, type OnboardingStatus } from './components/local-ai-contract'
import { isPermissionErrorMessage, permissionTarget } from './components/meeting-status'
import { PermissionBanner } from './components/permission-banner'
import { SettingsSheet } from './components/settings-sheet'
import { DashboardView } from './routes/dashboard-view'
import { OnboardingView } from './routes/onboarding-view'
import { SettingsView } from './routes/settings-view'
import { MANAGED_OLLAMA_MODEL, MANAGED_OLLAMA_MODEL_OPTIONS, isManagedOllamaModel, type ManagedOllamaModelTag } from '../shared/bundled-ollama'

type RecordingState = Awaited<ReturnType<typeof window.gappd.recording.getStatus>>
type Device = Awaited<ReturnType<typeof window.gappd.system.getDevices>>[number]
type MeetingListItem = Awaited<ReturnType<typeof window.gappd.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.gappd.meetings.show>>
type UpdateStatus = Awaited<ReturnType<typeof window.gappd.update.getStatus>>
const READY_ONBOARDING_PHASE: OnboardingStatus['phase'] = 'ready'
const IDLE_RECORDING_STATUS: RecordingState['status'] = 'idle'
const ERROR_RECORDING_STATUS: RecordingState['status'] = 'error'
const ACTIVE_RECORDING_STATUSES: RecordingState['status'][] = ['recording', 'stopping', 'processing']
const STARTABLE_RECORDING_STATUSES: RecordingState['status'][] = [IDLE_RECORDING_STATUS, ERROR_RECORDING_STATUS]
const STOPPABLE_RECORDING_STATUSES: RecordingState['status'][] = ACTIVE_RECORDING_STATUSES
const DYNAMIC_REFRESH_INTERVAL_MS = 5000
const DYNAMIC_REFRESH_MEETING_STATES: MeetingListItem['status']['state'][] = ['recording', 'processing']
const FOCUS_EVENT = 'focus'
const VISIBILITY_CHANGE_EVENT = 'visibilitychange'
const VISIBLE_DOCUMENT_STATE: DocumentVisibilityState = 'visible'
const localAI = getLocalAIContract()

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const selectedMeetingIdRef = useRef<string | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingDetail | null>(null)
  const selectedMeetingRef = useRef<MeetingDetail | null>(null)
  const selectedMeetingRequest = useRequestGate()
  const refreshRequest = useRequestGate()
  const settingsRequest = useRequestGate()
  const [selectedMeetingLoading, setSelectedMeetingLoading] = useState(false)
  const [selectedMeetingError, setSelectedMeetingError] = useState<string | null>(null)
  const [recording, setRecording] = useState<RecordingState>({ status: IDLE_RECORDING_STATUS })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [device, setDevice] = useState(0)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [selectedOnboardingModel, setSelectedOnboardingModel] = useState<ManagedOllamaModelTag>(MANAGED_OLLAMA_MODEL)
  const [settingsStatus, setSettingsStatus] = useState<LocalAIStatus | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  function applySelectedMeetingId(id: string | null) {
    selectedMeetingIdRef.current = id
    setSelectedMeetingId(id)
  }

  function applySelectedMeeting(meeting: MeetingDetail | null) {
    selectedMeetingRef.current = meeting
    setSelectedMeeting(meeting)
  }

  function isPermissionDeniedState(state: string): boolean {
    const normalized = state.trim().toLowerCase()
    return normalized.includes('denied') || normalized.includes('restricted')
  }

  async function refreshMeetings(preferredMeetingId?: string | null) {
    const requestId = refreshRequest.next()
    const items = await window.gappd.meetings.list()
    if (!refreshRequest.isCurrent(requestId)) return
    setMeetings(items)
    const nextId = preferredMeetingId ?? selectedMeetingIdRef.current ?? items[0]?.id ?? null
    if (!nextId) return clearSelectedMeeting()
    const resolvedMeetingId = items.some((meeting) => meeting.id === nextId) ? nextId : items[0]?.id ?? null
    if (!resolvedMeetingId) return clearSelectedMeeting()
    await loadMeeting(resolvedMeetingId)
  }

  function clearSelectedMeeting() {
    applySelectedMeetingId(null)
    applySelectedMeeting(null)
    setSelectedMeetingLoading(false)
    setSelectedMeetingError(null)
  }

  async function loadMeeting(id: string) {
    const requestId = selectedMeetingRequest.next()
    const showLoading = selectedMeetingRef.current?.id !== id
    applySelectedMeetingId(id)
    if (showLoading) applySelectedMeeting(null)
    if (showLoading) setSelectedMeetingLoading(true)
    setSelectedMeetingError(null)
    try {
      const meeting = await window.gappd.meetings.show(id)
      if (isCurrentMeetingRequest(requestId, id)) applySelectedMeeting(meeting)
    } catch (err) {
      if (isCurrentMeetingRequest(requestId, id)) {
        setSelectedMeetingError(err instanceof Error ? err.message : String(err))
        applySelectedMeeting(null)
      }
    } finally {
      if (isCurrentMeetingRequest(requestId, id)) setSelectedMeetingLoading(false)
    }
  }

  function isCurrentMeetingRequest(requestId: number, meetingId: string): boolean {
    return selectedMeetingRequest.isCurrent(requestId) && selectedMeetingIdRef.current === meetingId
  }

  async function loadAppData() {
    const [deviceList, meetingList, recordingState] = await Promise.all([
      window.gappd.system.getDevices(),
      window.gappd.meetings.list(),
      window.gappd.recording.getStatus(),
    ])
    setDevices(deviceList)
    setMeetings(meetingList)
    setRecording(recordingState)
    if (deviceList[0]) setDevice(deviceList[0].index)
    const initialMeetingId = recordingState.meetingId ?? meetingList[0]?.id ?? null
    if (!initialMeetingId) return clearSelectedMeeting()
    await loadMeeting(initialMeetingId)
  }

  function setErrorFromUnknown(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  function refreshDynamicMeeting(preferredMeetingId?: string | null) {
    void refreshMeetings(preferredMeetingId).catch(setErrorFromUnknown)
  }

  function documentIsVisible(): boolean {
    return document.visibilityState === VISIBLE_DOCUMENT_STATE
  }

  async function loadSettingsStatus() {
    const requestId = settingsRequest.next()
    setSettingsLoading(true)
    try {
      const status = await localAI.settings.getLocalAIStatus()
      if (isCurrentSettingsRequest(requestId)) setSettingsStatus(status)
    } catch (err) {
      if (isCurrentSettingsRequest(requestId)) setSettingsStatus(toStatusError(err))
    } finally {
      if (isCurrentSettingsRequest(requestId)) setSettingsLoading(false)
    }
  }

  function isCurrentSettingsRequest(requestId: number): boolean {
    return settingsRequest.isCurrent(requestId)
  }

  useEffect(() => {
    let disposed = false
    const dispose = localAI.onboarding.onStatusChanged((status) => {
      if (!disposed) setOnboarding(status)
    })
    ;(async () => {
      try {
        const status = await localAI.onboarding.getStatus()
        if (!disposed) setOnboarding(status)
      } catch (err) {
        if (!disposed) setOnboarding(toStatusError(err))
      } finally {
        if (!disposed) setLoading(false)
      }
    })()
    return () => {
      disposed = true
      dispose()
    }
  }, [])

  useEffect(() => {
    if (onboardingBusy || !onboarding || !isManagedOllamaModel(onboarding.model)) return
    setSelectedOnboardingModel(onboarding.model)
  }, [onboarding?.model, onboardingBusy])

  useEffect(() => {
    if (onboarding?.phase !== READY_ONBOARDING_PHASE) return
    let disposed = false
    const dispose = window.gappd.recording.onStatusChanged(async (state) => {
      if (disposed) return
      setRecording(state)
      const meetingId = state.meetingId ?? selectedMeetingIdRef.current
      if (state.meetingId) applySelectedMeetingId(state.meetingId)
      if (meetingId) {
        await refreshMeetings(meetingId)
        return
      }
      if (STARTABLE_RECORDING_STATUSES.includes(state.status)) await refreshMeetings()
    })
    void loadAppData().catch((err) => {
      if (!disposed) setErrorFromUnknown(err)
    })
    return () => {
      disposed = true
      dispose()
    }
  }, [onboarding?.phase])

  useEffect(() => {
    if (onboarding?.phase === READY_ONBOARDING_PHASE && settingsOpen) {
      void loadSettingsStatus()
      return
    }
    settingsRequest.cancel()
    setSettingsLoading(false)
  }, [onboarding?.phase, settingsOpen])

  useEffect(() => {
    let disposed = false
    window.gappd.update.getStatus()
      .then((status) => {
        if (!disposed) setUpdateStatus(status.available ? status : null)
      })
      .catch(() => {
        if (!disposed) setUpdateStatus(null)
      })
    return () => {
      disposed = true
    }
  }, [])

  const hasDynamicRefreshWork = useMemo(() => needsDynamicRefresh(meetings, recording), [meetings, recording.status])

  useEffect(() => {
    if (onboarding?.phase !== READY_ONBOARDING_PHASE) return
    function refreshWhenVisible() {
      if (documentIsVisible()) refreshDynamicMeeting()
    }
    window.addEventListener(FOCUS_EVENT, refreshWhenVisible)
    document.addEventListener(VISIBILITY_CHANGE_EVENT, refreshWhenVisible)
    return () => {
      window.removeEventListener(FOCUS_EVENT, refreshWhenVisible)
      document.removeEventListener(VISIBILITY_CHANGE_EVENT, refreshWhenVisible)
    }
  }, [onboarding?.phase])

  useEffect(() => {
    if (onboarding?.phase !== READY_ONBOARDING_PHASE || !hasDynamicRefreshWork) return
    const timer = window.setInterval(() => {
      refreshDynamicMeeting(selectedMeetingIdRef.current ?? recording.meetingId)
    }, DYNAMIC_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hasDynamicRefreshWork, onboarding?.phase, recording.meetingId])

  const canStart = devices.length > 0 && STARTABLE_RECORDING_STATUSES.includes(recording.status)
  const canStop = STOPPABLE_RECORDING_STATUSES.includes(recording.status)
  const transcript = useMemo(() => selectedMeeting?.transcriptText ?? '', [selectedMeeting])
  const bannerError = error ?? recording.error ?? null
  const isPermissionError = isPermissionErrorMessage(bannerError)

  function capturePermissionError(permissions: Awaited<ReturnType<typeof window.gappd.system.requestCapturePermissions>>): string | null {
    const microphoneDenied = isPermissionDeniedState(permissions.microphone)
    const screenDenied = isPermissionDeniedState(permissions.screen)
    const microphoneGranted = permissions.microphone === 'granted'
    const screenGranted = permissions.screen === 'granted'
    const permissionCheckFailed = !microphoneGranted && !microphoneDenied || !screenGranted && !screenDenied
    if (permissionCheckFailed) return 'Could not confirm microphone and screen recording permissions. Try again, then check System Settings if the problem continues.'
    if (microphoneDenied && screenDenied) return 'Microphone and Screen Recording access denied. Enable GappdCapture in System Settings to record.'
    if (microphoneDenied) return 'Microphone access denied. Enable GappdCapture in System Settings to record.'
    if (screenDenied) return 'Screen Recording access required. Enable GappdCapture in System Settings to capture system audio.'
    return null
  }

  async function handleStart() {
    try {
      setError(null)
      const permissions = await window.gappd.system.requestCapturePermissions()
      const permissionError = capturePermissionError(permissions)
      if (permissionError) {
        setError(permissionError)
        return
      }
      setRecording(await window.gappd.recording.start({ title: title.trim() || new Date().toLocaleString(), device, mode: 'both' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleStop() {
    try {
      setError(null)
      setRecording(await window.gappd.recording.stop())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleOpenPermissionsSettings() {
    try {
      const permissions = await window.gappd.system.requestCapturePermissions()
      const target = isPermissionDeniedState(permissions.microphone)
        ? 'microphone'
        : isPermissionDeniedState(permissions.screen)
          ? 'screen-recording'
          : permissionTarget(bannerError)
      await window.gappd.system.openPermissionsSettings(target)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function runOnboarding(action: 'start' | 'retry') {
    setOnboardingBusy(true)
    try {
      const input = { model: selectedOnboardingModel }
      setOnboarding(action === 'start' ? await localAI.onboarding.start(input) : await localAI.onboarding.retry(input))
    } catch (err) {
      setOnboarding(toStatusError(err))
    } finally {
      setOnboardingBusy(false)
    }
  }

  async function handleRepairLocalAI() {
    setSettingsBusy(true)
    try {
      const nextStatus = await localAI.settings.repairLocalAI()
      setSettingsStatus(nextStatus)
      setOnboarding(nextStatus)
    } catch (err) {
      setSettingsStatus(toStatusError(err))
    } finally {
      setSettingsBusy(false)
    }
  }

  async function handleOpenUpdate() {
    if (!updateStatus?.available) return
    try {
      await window.gappd.update.openUpdatePage()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading || !onboarding) return <div className="screen-center">Loading Gappd…</div>

  const appReady = onboarding.phase === READY_ONBOARDING_PHASE
  const showSettings = appReady && settingsOpen

  return (
    <div className="app-shell">
      <AppHeader appReady={appReady} settingsOpen={showSettings} updateStatus={updateStatus} onToggleSettings={() => setSettingsOpen((current) => !current)} onOpenUpdate={() => void handleOpenUpdate()} />
      <main className="app-main">
        {appReady ? <PermissionBanner error={bannerError} isPermissionError={isPermissionError} onRetry={() => void handleStart()} onOpenSettings={() => void handleOpenPermissionsSettings()} /> : null}
        {appReady ? (
          <DashboardView title={title} device={device} devices={devices} meetings={meetings} selectedMeetingId={selectedMeetingId} selectedMeeting={selectedMeeting} selectedMeetingLoading={selectedMeetingLoading} selectedMeetingError={selectedMeetingError} transcript={transcript} recordingStatus={recording.status} canStart={canStart} canStop={canStop} onTitleChange={setTitle} onDeviceChange={setDevice} onStart={() => void handleStart()} onStop={() => void handleStop()} onSelectMeeting={(id) => void loadMeeting(id)} />
        ) : (
          <div className="single-screen"><OnboardingView status={onboarding} busy={onboardingBusy} selectedModel={selectedOnboardingModel} modelOptions={MANAGED_OLLAMA_MODEL_OPTIONS} onModelChange={setSelectedOnboardingModel} onStart={() => void runOnboarding('start')} onRetry={() => void runOnboarding('retry')} onContinue={() => setSettingsOpen(false)} /></div>
        )}
      </main>
      {showSettings ? (
        <SettingsSheet onClose={() => setSettingsOpen(false)}>
          <SettingsView status={settingsStatus} loading={settingsLoading} busy={settingsBusy} onRepair={() => void handleRepairLocalAI()} />
        </SettingsSheet>
      ) : null}
    </div>
  )
}

function useRequestGate() {
  const requestRef = useRef(0)
  return {
    next: () => {
      requestRef.current += 1
      return requestRef.current
    },
    cancel: () => { requestRef.current += 1 },
    isCurrent: (requestId: number) => requestRef.current === requestId,
  }
}

function needsDynamicRefresh(meetings: MeetingListItem[], recording: RecordingState): boolean {
  if (ACTIVE_RECORDING_STATUSES.includes(recording.status)) return true
  return meetings.some((meeting) => DYNAMIC_REFRESH_MEETING_STATES.includes(meeting.status.state))
}
