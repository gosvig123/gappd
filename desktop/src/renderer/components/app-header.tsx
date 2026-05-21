import type { UpdateStatus } from '../../shared/contracts'

type AppHeaderProps = {
  appReady: boolean
  settingsOpen: boolean
  updateStatus: UpdateStatus | null
  onToggleSettings: () => void
  onOpenUpdate: () => void
}

export function AppHeader(props: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand-block"><div className="app-brand">Gappd</div><p>Record, review, and search local meeting notes.</p></div>
      <div className="app-controls" aria-label="App controls">
        {!props.settingsOpen && props.updateStatus?.available ? <button className="app-control update-control" onClick={props.onOpenUpdate} aria-label={`Download Gappd ${props.updateStatus.latestVersion}`} title={`Download v${props.updateStatus.latestVersion}`}>⇧<span>Update</span></button> : null}
        <button className={props.settingsOpen ? 'app-control settings-control active' : 'app-control settings-control'} onClick={props.onToggleSettings} disabled={!props.appReady} aria-label={props.settingsOpen ? 'Close settings' : 'Open settings'} aria-pressed={props.settingsOpen}>⚙<span>Settings</span></button>
      </div>
    </header>
  )
}

