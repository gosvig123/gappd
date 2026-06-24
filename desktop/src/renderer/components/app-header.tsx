import type { UpdateStatus } from '../../shared/contracts'

const UPDATE_LABEL = 'Update'

type AppHeaderProps = {
  appReady: boolean
  settingsOpen: boolean
  updateStatus: UpdateStatus | null
  updateDownloading: boolean
  onToggleSettings: () => void
  onDownloadUpdate: () => void
}

export function AppHeader(props: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand-block"><div className="app-brand">Gappd</div><p>Record, review, and search local meeting notes.</p></div>
      <div className="app-controls" aria-label="App controls">
        <UpdateControls {...props} />
        <button className={props.settingsOpen ? 'app-control settings-control active' : 'app-control settings-control'} onClick={props.onToggleSettings} disabled={!props.appReady} aria-label={props.settingsOpen ? 'Close settings' : 'Open settings'} aria-pressed={props.settingsOpen}>⚙<span>Settings</span></button>
      </div>
    </header>
  )
}

function UpdateControls(props: AppHeaderProps) {
  if (props.settingsOpen || !props.updateStatus?.available) return null
  const title = props.updateStatus.name ?? `${UPDATE_LABEL} to v${props.updateStatus.latestVersion}`
  const label = props.updateDownloading ? 'Updating…' : `v${props.updateStatus.latestVersion}`
  return <button className="app-control update-control" onClick={props.onDownloadUpdate} disabled={props.updateDownloading} aria-label={title} title={title}>⇧<span>{label}</span></button>
}
