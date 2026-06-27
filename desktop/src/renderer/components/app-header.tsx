import type { UpdateStatus } from '../../shared/contracts'
import { AppLogo } from './app-logo'

const UPDATE_LABEL = 'Update'

type AppHeaderProps = {
  appReady: boolean
  developerDebugEnabled: boolean
  settingsOpen: boolean
  updateStatus: UpdateStatus | null
  updateBlocked: boolean
  onToggleSettings: () => void
  onUpdatePrimary: () => void
}

type HeaderUpdateAction = { label: string; title: string; disabled?: boolean; installs?: boolean }

export function AppHeader(props: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand-block"><AppLogo className="app-logo" /><div className="app-brand">Gappd</div><p>Record, review, and search private meeting notes.</p></div>
      <div className="app-controls" aria-label="App controls">
        <UpdateControls {...props} />
        {props.developerDebugEnabled ? <button className={props.settingsOpen ? 'app-control settings-control active' : 'app-control settings-control'} onClick={props.onToggleSettings} disabled={!props.appReady} aria-label={props.settingsOpen ? 'Close developer debug' : 'Open developer debug'} aria-pressed={props.settingsOpen}>⚙<span>Developer Debug</span></button> : null}
      </div>
    </header>
  )
}

function UpdateControls(props: AppHeaderProps) {
  if (props.settingsOpen) return null
  const action = updateAction(props.updateStatus)
  if (!action) return null
  const disabled = action.disabled || Boolean(action.installs && props.updateBlocked)
  return <button className="app-control update-control" onClick={props.onUpdatePrimary} disabled={disabled} aria-label={action.title} title={action.title}>⇧<span>{action.label}</span></button>
}

function updateAction(status: UpdateStatus | null): HeaderUpdateAction | null {
  if (!status?.available) return null
  const version = status.latestVersion ? `v${status.latestVersion}` : UPDATE_LABEL
  if (status.phase === 'downloaded') return { label: 'Restart', title: `${version} ready to install`, installs: true }
  if (status.phase === 'downloading') return { label: progressLabel(status.progress), title: `Downloading ${version}`, disabled: true }
  if (status.phase === 'installing') return { label: 'Installing…', title: `Installing ${version}`, disabled: true }
  return { label: UPDATE_LABEL, title: `${version} available` }
}

function progressLabel(progress?: number): string {
  return Number.isFinite(progress) ? `${progress}%` : 'Updating…'
}
