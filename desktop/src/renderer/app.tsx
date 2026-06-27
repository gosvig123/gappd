import { useState } from 'react'
import { AppHeader } from './components/app-header'
import { MeetingAnnouncements } from './components/meeting-announcements'
import { PermissionBanner } from './components/permission-banner'
import { SettingsSheet } from './components/settings-sheet'
import { UpdateBanner } from './components/update-banner'
import { useDashboardData } from './hooks/use-dashboard-data'
import { useLocalAISettings } from './hooks/use-local-ai-settings'
import { useOnboarding } from './hooks/use-onboarding'
import { useSetupPermissions } from './hooks/use-setup-permissions'
import { useTranscriptionSettings } from './hooks/use-transcription-settings'
import { useUpdateStatus } from './hooks/use-update-status'
import { Banner } from './components/ui'
import { DashboardView } from './routes/dashboard-view'
import { OnboardingView } from './routes/onboarding-view'
import { SettingsView } from './routes/settings-view'
import { MANAGED_OLLAMA_MODEL_OPTIONS } from '../shared/bundled-ollama'

const READY_ONBOARDING_PHASE = 'ready'

export function App() {
  const onboarding = useOnboarding()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const developerDebugEnabled = import.meta.env.DEV
  const aiReady = onboarding.status?.phase === READY_ONBOARDING_PHASE
  const permissions = useSetupPermissions(Boolean(aiReady))
  const appReady = Boolean(aiReady && permissions.ready)
  const settingsPanelOpen = appReady && settingsOpen
  const dashboard = useDashboardData(appReady)
  const localAI = useLocalAISettings(settingsPanelOpen && developerDebugEnabled, onboarding.setStatus)
  const transcription = useTranscriptionSettings(settingsPanelOpen)
  const update = useUpdateStatus()
  if (onboarding.loading || !onboarding.status) return <div className="screen-center">Starting Gappd…</div>
  return <div className="app-shell"><AppHeader appReady={appReady} settingsOpen={settingsPanelOpen} updateStatus={update.status} updateBlocked={dashboard.recording.status !== 'idle'} onToggleSettings={() => setSettingsOpen((current) => !current)} onUpdatePrimary={() => void runPrimaryUpdate(update, dashboard.actions.setError)} /><main className="app-main">{appReady ? <ReadyApp dashboard={dashboard} update={update} /> : <OnboardingApp onboarding={onboarding} permissions={permissions} />}</main>{settingsPanelOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)}><SettingsView localAI={{ ...localAI, onRepair: () => void localAI.repair() }} transcription={transcription} developerDebugEnabled={developerDebugEnabled} /></SettingsSheet> : null}</div>
}

function ReadyApp({ dashboard, update }: { dashboard: ReturnType<typeof useDashboardData>; update: ReturnType<typeof useUpdateStatus> }) {
  const reportError = dashboard.actions.setError
  return <><PermissionBanner error={dashboard.bannerError} isPermissionError={dashboard.isPermissionError} onRetry={() => void dashboard.actions.start()} onOpenSettings={() => void dashboard.actions.openPermissionsSettings()} /><StaleRecoveryBanner recovering={dashboard.recoveringStale} notice={dashboard.staleRecoveryNotice} /><UpdateBanner status={update.status} recordingStatus={dashboard.recording.status} onDownload={() => void runUpdate(update.downloadUpdate, reportError)} onInstall={() => void runUpdate(update.installAndRestart, reportError)} onOpenReleasePage={() => void runUpdate(update.openUpdatePage, reportError)} onCheckNow={() => void runUpdate(update.checkNow, reportError)} /><MeetingAnnouncements meetings={dashboard.meetings} recording={dashboard.recording} onOpenMeeting={(id) => void dashboard.actions.loadMeeting(id)} /><DashboardView device={dashboard.device} devices={dashboard.devices} meetings={dashboard.meetings} selectedMeetingId={dashboard.selectedMeetingId} selectedMeeting={dashboard.selectedMeeting} selectedMeetingLoading={dashboard.selectedMeetingLoading} selectedMeetingError={dashboard.selectedMeetingError} transcript={dashboard.transcript} recordingStatus={dashboard.recording.status} canStart={dashboard.canStart} canStop={dashboard.canStop} onDeviceChange={dashboard.actions.setDevice} onStart={() => void dashboard.actions.start()} onStop={() => void dashboard.actions.stop()} onSelectMeeting={(id) => void dashboard.actions.loadMeeting(id)} onClearSelection={dashboard.actions.clearSelectedMeeting} onDeleteMeeting={dashboard.actions.deleteMeeting} /></>
}

function StaleRecoveryBanner({ recovering, notice }: { recovering: boolean; notice: string | null }) {
  if (recovering) return <Banner title="Checking previous recordings">Recovering any interrupted recording in the background.</Banner>
  if (notice) return <Banner>{notice}</Banner>
  return null
}

function OnboardingApp({ onboarding, permissions }: { onboarding: ReturnType<typeof useOnboarding>; permissions: ReturnType<typeof useSetupPermissions> }) {
  return <div className="single-screen"><OnboardingView status={onboarding.status!} busy={onboarding.busy} selectedModel={onboarding.selectedModel} modelOptions={MANAGED_OLLAMA_MODEL_OPTIONS} permissionState={permissions.state} onModelChange={onboarding.setSelectedModel} onStart={() => void onboarding.run('start')} onRetry={() => void onboarding.run('retry')} onRequestPermissions={() => void permissions.request()} /></div>
}

async function runPrimaryUpdate(update: ReturnType<typeof useUpdateStatus>, reportError: (message: string) => void) {
  if (update.status?.phase === 'downloaded') return runUpdate(update.installAndRestart, reportError)
  if (update.status?.phase === 'available') return runUpdate(update.downloadUpdate, reportError)
}

async function runUpdate(action: () => Promise<unknown>, reportError: (message: string) => void) {
  try {
    await action()
  } catch (err) {
    reportError(err instanceof Error ? err.message : String(err))
  }
}
