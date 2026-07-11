import { useState } from 'react'
import { AppHeader } from './components/app-header'
import { ManagedRuntimeBanner } from './components/managed-runtime-banner'
import { MeetingAnnouncements } from './components/meeting-announcements'
import { PageSearch } from './components/page-search'
import { PermissionBanner } from './components/permission-banner'
import { SettingsSheet } from './components/settings-sheet'
import { UpdateBanner } from './components/update-banner'
import { Banner, Button } from './components/ui'
import { useDashboardData } from './hooks/use-dashboard-data'
import { useManagedRuntime } from './hooks/use-managed-runtime'
import { useSetupPermissions } from './hooks/use-setup-permissions'
import { useUpdateStatus } from './hooks/use-update-status'
import { DashboardView } from './routes/dashboard-view'
import { SettingsView } from './routes/settings-view'

export function App() {
  const runtime = useManagedRuntime()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const permissions = useSetupPermissions(true)
  const dashboard = useDashboardData(true)
  const update = useUpdateStatus()
  const recordingReady = permissions.ready
  return <div className="app-shell"><AppHeader appReady settingsOpen={settingsOpen} updateStatus={update.status} updateBlocked={dashboard.recording.status !== 'idle'} onToggleSettings={() => setSettingsOpen((value) => !value)} onUpdatePrimary={() => void runPrimaryUpdate(update, dashboard.actions.setError)} /><main className="app-main"><DashboardApp dashboard={dashboard} update={update} runtime={runtime} permissions={permissions} recordingReady={recordingReady} /></main>{settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)}><SettingsView language={dashboard.language} onLanguageChange={dashboard.actions.setLanguage} localAI={{ status: runtime.status, loading: runtime.loading, busy: runtime.busy, onRepair: () => void runtime.prepare('repair') }} developerDebugEnabled={import.meta.env.DEV} /></SettingsSheet> : null}<PageSearch /></div>
}

function DashboardApp({ dashboard, update, runtime, permissions, recordingReady }: DashboardProps) {
  const reportError = dashboard.actions.setError
  return <>{runtime.status ? <ManagedRuntimeBanner snapshot={runtime.status} busy={runtime.busy} onSetup={() => void runtime.prepare('setup')} onRepair={() => void runtime.prepare('repair')} /> : null}<PermissionsSetupBanner visible={!permissions.ready} busy={permissions.state.status === 'checking'} onRequest={() => void permissions.request()} /><PermissionBanner error={dashboard.bannerError} isPermissionError={dashboard.isPermissionError} onRetry={() => void dashboard.actions.start()} onOpenSettings={() => void dashboard.actions.openPermissionsSettings()} /><StaleRecoveryBanner recovering={dashboard.recoveringStale} notice={dashboard.staleRecoveryNotice} /><UpdateBanner status={update.status} recordingStatus={dashboard.recording.status} onDownload={() => void runUpdate(update.downloadUpdate, reportError)} onInstall={() => void runUpdate(update.installAndRestart, reportError)} onOpenReleasePage={() => void runUpdate(update.openUpdatePage, reportError)} onCheckNow={() => void runUpdate(update.checkNow, reportError)} /><MeetingAnnouncements meetings={dashboard.meetings} recording={dashboard.recording} onOpenMeeting={(id) => void dashboard.actions.loadMeeting(id)} /><DashboardView device={dashboard.device} devices={dashboard.devices} meetings={dashboard.meetings} selectedMeetingId={dashboard.selectedMeetingId} selectedMeeting={dashboard.selectedMeeting} selectedMeetingLoading={dashboard.selectedMeetingLoading} selectedMeetingError={dashboard.selectedMeetingError} transcript={dashboard.transcript} recordingStatus={dashboard.recording.status} canStart={recordingReady && dashboard.canStart} canStop={dashboard.canStop} onDeviceChange={dashboard.actions.setDevice} onStart={() => void dashboard.actions.start()} onStop={() => void dashboard.actions.stop()} onSelectMeeting={(id) => void dashboard.actions.loadMeeting(id)} onClearSelection={dashboard.actions.clearSelectedMeeting} onDeleteMeeting={dashboard.actions.deleteMeeting} /></>
}

type DashboardProps = { dashboard: ReturnType<typeof useDashboardData>; update: ReturnType<typeof useUpdateStatus>; runtime: ReturnType<typeof useManagedRuntime>; permissions: ReturnType<typeof useSetupPermissions>; recordingReady: boolean }

function PermissionsSetupBanner({ visible, busy, onRequest }: { visible: boolean; busy: boolean; onRequest: () => void }) {
  if (!visible) return null
  return <Banner title="Allow recording access" actions={<Button variant="primary" onClick={onRequest} disabled={busy}>{busy ? 'Checking…' : 'Allow recording access'}</Button>}>Gappd needs microphone and screen/system audio access before your first recording.</Banner>
}

function StaleRecoveryBanner({ recovering, notice }: { recovering: boolean; notice: string | null }) {
  if (recovering) return <Banner title="Checking previous recordings">Recovering any interrupted recording in the background.</Banner>
  return notice ? <Banner>{notice}</Banner> : null
}

async function runPrimaryUpdate(update: ReturnType<typeof useUpdateStatus>, reportError: (message: string) => void) {
  if (update.status?.phase === 'downloaded') return runUpdate(update.installAndRestart, reportError)
  if (update.status?.phase === 'available') return runUpdate(update.downloadUpdate, reportError)
}

async function runUpdate(action: () => Promise<unknown>, reportError: (message: string) => void) {
  try { await action() } catch (error) { reportError(error instanceof Error ? error.message : String(error)) }
}
