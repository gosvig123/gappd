import type { UpdateStatus } from '../../shared/contracts'
import { VIEW_MEETINGS, VIEW_SETTINGS, VIEW_TODAY, type View } from '../views'
import { onboardingPhaseLabel, type OnboardingStatus } from './local-ai-contract'

type AppSidebarProps = {
  onboarding: OnboardingStatus
  view: View
  updateStatus: UpdateStatus | null
  onViewChange: (view: View) => void
  onOpenUpdate: () => void
}

export function AppSidebar({ onboarding, view, updateStatus, onViewChange, onOpenUpdate }: AppSidebarProps) {
  const appReady = onboarding.phase === 'ready'
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-caption">{appReady ? 'Meeting inbox' : onboardingPhaseLabel(onboarding.phase)}</div>
        <div className="brand">Gappd</div>
      </div>

      <div className="sidebar-section">
        <nav className="nav">
          <button className={view === VIEW_TODAY ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange(VIEW_TODAY)} disabled={!appReady} aria-current={view === VIEW_TODAY ? 'page' : undefined}>
            <strong>Today</strong>
          </button>
          <button className={view === VIEW_MEETINGS ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange(VIEW_MEETINGS)} disabled={!appReady} aria-current={view === VIEW_MEETINGS ? 'page' : undefined}>
            <strong>Meetings</strong>
          </button>
        </nav>
      </div>

      <div className="sidebar-footer">
        {updateStatus?.available ? <UpdateButton status={updateStatus} onOpenUpdate={onOpenUpdate} /> : null}
        <nav className="nav">
          <button className={view === VIEW_SETTINGS ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange(VIEW_SETTINGS)} aria-current={view === VIEW_SETTINGS ? 'page' : undefined}>
            <strong>Settings</strong>
          </button>
        </nav>
      </div>
    </aside>
  )
}

function UpdateButton({ status, onOpenUpdate }: { status: Extract<UpdateStatus, { available: true }>; onOpenUpdate: () => void }) {
  return (
    <button className="update-cta" onClick={onOpenUpdate}>
      <strong>Update available</strong>
      <small>Download v{status.latestVersion}</small>
    </button>
  )
}
