import type { UpdateStatus } from '../../shared/contracts'
import { runtimeErrorView, runtimeOperationLabel } from '../components/managed-runtime-contract'
import type { AppView } from './app-view'

export type AlertKind = 'blocking' | 'attention' | 'info'

export type AlertItem = {
  id: string
  kind: AlertKind
  title: string
  detail?: string
  actionLabel?: string
  run?: () => void
}

/**
 * One ordered list of everything that wants the user's attention. The shell
 * decides how to present it: blocking items get a banner, the rest become
 * dismissible notifications. Nothing stacks a second banner.
 */
export function buildAlerts(view: AppView): AlertItem[] {
  const items: AlertItem[] = []
  if (!view.permissionsReady) {
    items.push({ id: 'permissions', kind: 'blocking', title: 'Recording access is not ready', detail: 'Gappd needs microphone and screen and system audio access before the first recording.', actionLabel: view.permissionsBusy ? 'Checking…' : 'Allow recording access', run: view.actions.requestPermissions })
  }
  if (view.bannerError) {
    items.push(view.isPermissionError
      ? { id: 'error', kind: 'attention', title: 'Recording could not start', detail: view.bannerError, actionLabel: 'Try again', run: () => view.actions.start() }
      : { id: 'error', kind: 'attention', title: 'Something needs attention', detail: view.bannerError, actionLabel: 'Open System Settings', run: view.actions.openPermissionsSettings })
  }
  for (const runtimeAlert of runtimeAlerts(view)) items.push(runtimeAlert)
  if (view.recoveringStale) items.push({ id: 'stale-recovery', kind: 'info', title: 'Checking previous recordings', detail: 'Recovering any interrupted recording in the background.' })
  if (view.staleRecoveryNotice) items.push({ id: 'stale-notice', kind: 'info', title: 'Previous recording recovered', detail: view.staleRecoveryNotice })
  const broken = view.calendar?.connections.find((connection) => connection.status === 'error')
  if (broken) items.push({ id: `calendar-${broken.id}`, kind: 'attention', title: `${broken.email} needs reconnecting`, detail: broken.error, actionLabel: 'Reconnect', run: () => void view.actions.connectCalendar() })
  if (view.calendarError) items.push({ id: 'calendar-error', kind: 'attention', title: 'Calendar refresh failed', detail: view.calendarError, actionLabel: 'Try again', run: () => void view.actions.syncAllCalendars() })
  if (view.update?.available) items.push(updateAlert(view.update, view))
  if (view.selectedMeetingError) items.push({ id: 'meeting-error', kind: 'attention', title: 'Could not open that Meeting', detail: view.selectedMeetingError })
  return items.filter((item) => !view.alertDismissals.has(item.id))
}

function runtimeAlerts(view: AppView): AlertItem[] {
  const runtime = view.runtime
  if (!runtime) return []
  if (runtimeErrorView(runtime)) return [{ id: 'runtime-error', kind: 'attention', title: 'Local AI needs repair', detail: runtime.message, actionLabel: view.runtimeBusy ? 'Repairing…' : 'Repair local AI', run: view.actions.repairRuntime }]
  if (runtime.operation === 'needs_setup') return [{ id: 'runtime-setup', kind: 'attention', title: 'Local AI setup is incomplete', detail: runtime.message, actionLabel: view.runtimeBusy ? 'Preparing…' : 'Set up local AI', run: view.actions.setupRuntime }]
  if (runtime.operation !== 'ready') return [{ id: 'runtime-busy', kind: 'info', title: runtimeOperationLabel(runtime.operation), detail: runtime.message }]
  return []
}

function updateAlert(status: UpdateStatus, view: AppView): AlertItem {
  const version = status.latestVersion ? `Gappd ${status.latestVersion}` : 'A new version'
  const action = status.phase === 'downloaded'
    ? { actionLabel: 'Restart and install', run: () => void view.actions.installUpdate() }
    : status.phase === 'downloading' || status.phase === 'installing'
      ? { actionLabel: updateActionLabel(status), run: () => void view.actions.checkForUpdate() }
      : { actionLabel: 'Download update', run: () => void view.actions.downloadUpdate() }
  return { id: 'update', kind: 'info', title: `${version} is ready to install`, detail: `You are on ${status.currentVersion}. Installing restarts Gappd.`, ...action }
}

export function updateActionLabel(status: UpdateStatus): string {
  if (status.phase === 'downloaded') return 'Restart and install'
  if (status.phase === 'downloading') return `Downloading ${status.progress ?? 0}%`
  if (status.phase === 'installing') return 'Installing…'
  return 'Download update'
}
