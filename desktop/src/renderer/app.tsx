import { useEffect, useMemo, useRef, useState } from 'react'
import { AppSidebar } from './components/app-sidebar'
import { getLocalAIContract, toStatusError, type LocalAIStatus, type OnboardingStatus } from './components/local-ai-contract'
import { isPermissionErrorMessage, permissionTarget } from './components/meeting-status'
import { PermissionBanner } from './components/permission-banner'
import { MeetingsView } from './routes/meetings-view'
import { OnboardingView } from './routes/onboarding-view'
import { RecordView } from './routes/record-view'
import { SettingsView } from './routes/settings-view'
type RecordingState = Awaited<ReturnType<typeof window.gappd.recording.getStatus>>
type Device = Awaited<ReturnType<typeof window.gappd.system.getDevices>>[number]
type MeetingListItem = Awaited<ReturnType<typeof window.gappd.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.gappd.meetings.show>>
type View = 'record' | 'meetings' | 'settings'
const localAI = getLocalAIContract()

export function App() {
  const [view, setView] = useState<View>('record')
  const [devices, setDevices] = useState<Device[]>([])
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const selectedMeetingIdRef = useRef<string | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingDetail | null>(null)
  const [selectedMeetingLoading, setSelectedMeetingLoading] = useState(false)
  const [selectedMeetingError, setSelectedMeetingError] = useState<string | null>(null)
  const [recording, setRecording] = useState<RecordingState>({ status: 'idle' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [device, setDevice] = useState(0)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState<LocalAIStatus | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)

  function applySelectedMeetingId(id: string | null) {
    selectedMeetingIdRef.current = id
    setSelectedMeetingId(id)
  }

  function isPermissionDeniedState(state: string): boolean {
    const normalized = state.trim().toLowerCase()
    return normalized.includes('denied') || normalized.includes('restricted')
  }

  async function refreshMeetings(preferredMeetingId?: string | null) {
    const items = await window.gappd.meetings.list()
    setMeetings(items)
    const nextId = preferredMeetingId ?? selectedMeetingIdRef.current ?? items[0]?.id ?? null
    if (!nextId) {
      applySelectedMeetingId(null)
      setSelectedMeeting(null)
      setSelectedMeetingLoading(false)
      setSelectedMeetingError(null)
      return
    }
    const resolvedMeetingId = items.some((meeting) => meeting.id === nextId) ? nextId : items[0]?.id ?? null
    if (!resolvedMeetingId) {
      applySelectedMeetingId(null)
      setSelectedMeeting(null)
      setSelectedMeetingLoading(false)
      setSelectedMeetingError(null)
      return
    }
    await loadMeeting(resolvedMeetingId)
  }
  async function loadMeeting(id: string) {
    applySelectedMeetingId(id)
    setSelectedMeeting(null)
    setSelectedMeetingLoading(true)
    setSelectedMeetingError(null)
    try {
      const meeting = await window.gappd.meetings.show(id)
      if (selectedMeetingIdRef.current === id) setSelectedMeeting(meeting)
    } catch (err) {
      if (selectedMeetingIdRef.current === id) {
        setSelectedMeetingError(err instanceof Error ? err.message : String(err))
        setSelectedMeeting(null)
      }
    } finally {
      if (selectedMeetingIdRef.current === id) setSelectedMeetingLoading(false)
    }
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
    if (!initialMeetingId) {
      applySelectedMeetingId(null)
      setSelectedMeeting(null)
      setSelectedMeetingLoading(false)
      setSelectedMeetingError(null)
      return
    }
    await loadMeeting(initialMeetingId)
  }
  async function loadSettingsStatus() {
    setSettingsLoading(true)
    try {
      setSettingsStatus(await localAI.settings.getLocalAIStatus())
    } catch (err) {
      setSettingsStatus(toStatusError(err))
    } finally {
      setSettingsLoading(false)
    }
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
    if (onboarding?.phase !== 'ready') return
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
      if (state.status === 'idle' || state.status === 'error') await refreshMeetings()
    })
    void loadAppData().catch((err) => {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      disposed = true
      dispose()
    }
  }, [onboarding?.phase])

  useEffect(() => {
    if (onboarding?.phase === 'ready' && view === 'settings') void loadSettingsStatus()
  }, [onboarding?.phase, view])

  const canStart = devices.length > 0 && recording.status === 'idle'
  const canStop = ['recording', 'stopping', 'processing'].includes(recording.status)
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
      await window.gappd.recording.start({ title: title.trim() || new Date().toLocaleString(), device, mode: 'both' })
      setView('record')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  async function handleStop() {
    try {
      setError(null)
      await window.gappd.recording.stop()
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
      setOnboarding(action === 'start' ? await localAI.onboarding.start() : await localAI.onboarding.retry())
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

  if (loading || !onboarding) return <div className="screen-center">Loading Gappd…</div>

  return (
    <div className="app-shell">
      <AppSidebar onboarding={onboarding} recording={recording} view={view} onViewChange={setView} />
      <main className="main-grid">
        {onboarding.phase !== 'ready' ? (
          <OnboardingView status={onboarding} busy={onboardingBusy} onStart={() => void runOnboarding('start')} onRetry={() => void runOnboarding('retry')} />
        ) : view === 'record' ? (
          <RecordView title={title} device={device} devices={devices} canStart={canStart} canStop={canStop} onTitleChange={setTitle} onDeviceChange={setDevice} onStart={() => void handleStart()} onStop={() => void handleStop()} />
        ) : view === 'meetings' ? (
          <MeetingsView meetings={meetings} selectedMeetingId={selectedMeetingId} selectedMeeting={selectedMeeting} selectedMeetingLoading={selectedMeetingLoading} selectedMeetingError={selectedMeetingError} transcript={transcript} onRefresh={() => void refreshMeetings()} onSelectMeeting={(id) => void loadMeeting(id)} />
        ) : (
          <SettingsView status={settingsStatus} loading={settingsLoading} busy={settingsBusy} onRepair={() => void handleRepairLocalAI()} />
        )}
        {onboarding.phase === 'ready' ? (
          <PermissionBanner error={bannerError} isPermissionError={isPermissionError} onRetry={() => void handleStart()} onOpenSettings={() => void handleOpenPermissionsSettings()} />
        ) : null}
      </main>
    </div>
  )
}
