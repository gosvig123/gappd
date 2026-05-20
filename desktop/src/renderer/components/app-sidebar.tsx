import { onboardingPhaseLabel, type OnboardingStatus } from './local-ai-contract'
type View = 'record' | 'meetings' | 'settings'

type AppSidebarProps = {
  onboarding: OnboardingStatus
  view: View
  onViewChange: (view: View) => void
}

export function AppSidebar({ onboarding, view, onViewChange }: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-caption">{onboarding.phase === 'ready' ? 'Desktop recorder' : onboardingPhaseLabel(onboarding.phase)}</div>
        <div className="brand">Gappd</div>
      </div>

      {onboarding.phase === 'ready' ? (
        <div className="sidebar-section">
          <nav className="nav">
            <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('record')} aria-current={view === 'record' ? 'page' : undefined}>
              <strong>Record</strong>
            </button>
            <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('meetings')} aria-current={view === 'meetings' ? 'page' : undefined}>
              <strong>Meetings</strong>
            </button>
            <button className={view === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('settings')} aria-current={view === 'settings' ? 'page' : undefined}>
              <strong>Local AI</strong>
            </button>
          </nav>
        </div>
      ) : (
        <div className="sidebar-section">
          <nav className="nav">
            <div className="nav-btn active nav-current" aria-current="page">
              <strong>Setup</strong>
            </div>
          </nav>
        </div>
      )}
    </aside>
  )
}
