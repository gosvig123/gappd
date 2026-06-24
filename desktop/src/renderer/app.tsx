import { useState } from 'react'
import { AppHeader } from './components/app-header'
import { PermissionBanner } from './components/permission-banner'
import { SettingsSheet } from './components/settings-sheet'
import { useDashboardData } from './hooks/use-dashboard-data'
import { useLocalAISettings } from './hooks/use-local-ai-settings'
import { useOnboarding } from './hooks/use-onboarding'
import { useSetupPermissions } from './hooks/use-setup-permissions'
import { useUpdateStatus } from './hooks/use-update-status'
import { DashboardView } from './routes/dashboard-view'
import { OnboardingView } from './routes/onboarding-view'
import { SettingsView } from './routes/settings-view'
import { MANAGED_OLLAMA_MODEL_OPTIONS } from '../shared/bundled-ollama'

const READY_ONBOARDING_PHASE = 'ready'

export function App() {
  const onboarding = useOnboarding()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const aiReady = onboarding.status?.phase === READY_ONBOARDING_PHASE
  const permissions = useSetupPermissions(Boolean(aiReady))
  const appReady = Boolean(aiReady && permissions.ready)
  const dashboard = useDashboardData(appReady)
  const settings = useLocalAISettings(appReady && settingsOpen, onboarding.setStatus)
  const update = useUpdateStatus()

  if (onboarding.loading || !onboarding.status) return <div className="screen-center">Loading Gappd…</div>

  return (
    <div className="app-shell">
      <AppHeader appReady={appReady} settingsOpen={settingsOpen && appReady} updateStatus={update.status} updateDownloading={update.downloading} onToggleSettings={() => setSettingsOpen((current) => !current)} onDownloadUpdate={() => void downloadUpdate(update.downloadUpdate, dashboard.actions.setError)} />
      <main className="app-main">
        {appReady ? <ReadyApp dashboard={dashboard} /> : <OnboardingApp onboarding={onboarding} permissions={permissions} />}
      </main>
      {settingsOpen && appReady ? <SettingsSheet onClose={() => setSettingsOpen(false)}><SettingsView {...settings} onRepair={() => void settings.repair()} /></SettingsSheet> : null}
    </div>
  )
}

function ReadyApp({ dashboard }: { dashboard: ReturnType<typeof useDashboardData> }) {
  return <><PermissionBanner error={dashboard.bannerError} isPermissionError={dashboard.isPermissionError} onRetry={() => void dashboard.actions.start()} onOpenSettings={() => void dashboard.actions.openPermissionsSettings()} /><DashboardView device={dashboard.device} devices={dashboard.devices} meetings={dashboard.meetings} selectedMeetingId={dashboard.selectedMeetingId} selectedMeeting={dashboard.selectedMeeting} selectedMeetingLoading={dashboard.selectedMeetingLoading} selectedMeetingError={dashboard.selectedMeetingError} transcript={dashboard.transcript} recordingStatus={dashboard.recording.status} canStart={dashboard.canStart} canStop={dashboard.canStop} onDeviceChange={dashboard.actions.setDevice} onStart={() => void dashboard.actions.start()} onStop={() => void dashboard.actions.stop()} onSelectMeeting={(id) => void dashboard.actions.loadMeeting(id)} onDeleteMeeting={dashboard.actions.deleteMeeting} /></>
}

function OnboardingApp({ onboarding, permissions }: { onboarding: ReturnType<typeof useOnboarding>; permissions: ReturnType<typeof useSetupPermissions> }) {
  return <div className="single-screen"><OnboardingView status={onboarding.status!} busy={onboarding.busy} selectedModel={onboarding.selectedModel} modelOptions={MANAGED_OLLAMA_MODEL_OPTIONS} permissionState={permissions.state} onModelChange={onboarding.setSelectedModel} onStart={() => void onboarding.run('start')} onRetry={() => void onboarding.run('retry')} onRequestPermissions={() => void permissions.request()} /></div>
}

async function downloadUpdate(download: ReturnType<typeof useUpdateStatus>['downloadUpdate'], reportError: (message: string) => void) {
  try {
    await download()
  } catch (err) {
    reportError(err instanceof Error ? err.message : String(err))
  }
}
