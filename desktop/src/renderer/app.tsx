import { useState } from 'react'
import { AppHeader } from './components/app-header'
import { MeetingAnnouncements } from './components/meeting-announcements'
import { PageSearch } from './components/page-search'
import { PermissionBanner } from './components/permission-banner'
import { SettingsSheet } from './components/settings-sheet'
import { UpdateBanner } from './components/update-banner'
import { useDashboardData } from './hooks/use-dashboard-data'
import { useLocalAISettings } from './hooks/use-local-ai-settings'
import { useLocalAISetupOperation } from './hooks/use-local-ai-setup-operation'
import { useSetupPermissions } from './hooks/use-setup-permissions'
import { useUpdateStatus } from './hooks/use-update-status'
import { Banner } from './components/ui'
import { DashboardView } from './routes/dashboard-view'
import { LocalAISetupView } from './routes/local-ai-setup-view'
import { SettingsView } from './routes/settings-view'
import { MANAGED_LLAMACPP_MODEL_OPTIONS } from '../shared/managed-local-ai'

const READY_LOCAL_AI_SETUP_PHASE = 'ready'

export function App() {
  const localAISetup = useLocalAISetupOperation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const developerDebugEnabled = import.meta.env.DEV
  const aiReady = localAISetup.status?.phase === READY_LOCAL_AI_SETUP_PHASE
  const permissions = useSetupPermissions(Boolean(aiReady))
  const appReady = Boolean(aiReady && permissions.ready)
  const settingsPanelOpen = appReady && settingsOpen
  const dashboard = useDashboardData(appReady)
  const localAI = useLocalAISettings(settingsPanelOpen && developerDebugEnabled, localAISetup.setStatus)
  const update = useUpdateStatus()
  if (localAISetup.loading || !localAISetup.status) return <div className="screen-center">Starting Gappd…</div>
  return <div className="app-shell"><AppHeader appReady={appReady} settingsOpen={settingsPanelOpen} updateStatus={update.status} updateBlocked={dashboard.recording.status !== 'idle'} onToggleSettings={() => setSettingsOpen((current) => !current)} onUpdatePrimary={() => void runPrimaryUpdate(update, dashboard.actions.setError)} /><main className="app-main">{appReady ? <ReadyApp dashboard={dashboard} update={update} /> : <LocalAISetupApp localAISetup={localAISetup} permissions={permissions} />}</main>{settingsPanelOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)}><SettingsView language={dashboard.language} onLanguageChange={dashboard.actions.setLanguage} localAI={{ ...localAI, onRepair: () => void localAI.repair() }} developerDebugEnabled={developerDebugEnabled} /></SettingsSheet> : null}<PageSearch /></div>
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

function LocalAISetupApp({ localAISetup, permissions }: { localAISetup: ReturnType<typeof useLocalAISetupOperation>; permissions: ReturnType<typeof useSetupPermissions> }) {
  return <div className="single-screen"><LocalAISetupView status={localAISetup.status!} busy={localAISetup.busy} selectedModel={localAISetup.selectedModel} modelOptions={MANAGED_LLAMACPP_MODEL_OPTIONS} permissionState={permissions.state} onModelChange={localAISetup.setSelectedModel} onStart={() => void localAISetup.run('start')} onRetry={() => void localAISetup.run('retry')} onRequestPermissions={() => void permissions.request()} /></div>
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
