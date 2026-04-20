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
        <div className="subtitle">{onboarding.phase === 'ready' ? 'Record, review, and repair local AI.' : 'Finish setup to unlock recording and meetings.'}</div>
      </div>

      {onboarding.phase === 'ready' ? (
        <div className="sidebar-section">
          <div className="sidebar-nav-label">Navigation</div>
          <nav className="nav">
            <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('record')} aria-current={view === 'record' ? 'page' : undefined}>
              <strong>Record</strong>
              <span>Capture a meeting.</span>
            </button>
            <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('meetings')} aria-current={view === 'meetings' ? 'page' : undefined}>
              <strong>Meetings</strong>
              <span>Review saved sessions.</span>
            </button>
            <button className={view === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('settings')} aria-current={view === 'settings' ? 'page' : undefined}>
              <strong>Settings</strong>
              <span>Check local AI health.</span>
            </button>
          </nav>
        </div>
      ) : (
        <div className="sidebar-section">
          <div className="sidebar-nav-label">Navigation</div>
          <nav className="nav">
            <div className="nav-btn active nav-current" aria-current="page">
              <strong>Setup</strong>
              <span>Prepare local AI first.</span>
            </div>
          </nav>
        </div>
      )}
    </aside>
  )
}
