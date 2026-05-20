import { onboardingPhaseLabel, type OnboardingStatus } from './local-ai-contract'
type View = 'record' | 'meetings' | 'settings'

type AppSidebarProps = {
  onboarding: OnboardingStatus
  view: View
  onViewChange: (view: View) => void
}

export function AppSidebar({ onboarding, view, onViewChange }: AppSidebarProps) {
  const appReady = onboarding.phase === 'ready'
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-caption">{appReady ? 'Desktop recorder' : onboardingPhaseLabel(onboarding.phase)}</div>
        <div className="brand">Gappd</div>
      </div>

      <div className="sidebar-section">
        <nav className="nav">
          <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('record')} disabled={!appReady} aria-current={view === 'record' ? 'page' : undefined}>
            <strong>Record</strong>
          </button>
          <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('meetings')} disabled={!appReady} aria-current={view === 'meetings' ? 'page' : undefined}>
            <strong>Meetings</strong>
          </button>
        </nav>
      </div>

      <div className="sidebar-footer">
        <nav className="nav">
          <button className={view === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('settings')} aria-current={view === 'settings' ? 'page' : undefined}>
            <strong>Settings</strong>
          </button>
        </nav>
      </div>
    </aside>
  )
}
