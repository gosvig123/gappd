import { onboardingPhaseLabel, type OnboardingStatus } from './local-ai-contract'
type View = 'setup' | 'record' | 'meetings' | 'settings'

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
          <button className={view === 'setup' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('setup')} aria-current={view === 'setup' ? 'page' : undefined}>
            <strong>Setup</strong>
          </button>
          <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('record')} disabled={!appReady} aria-current={view === 'record' ? 'page' : undefined}>
            <strong>Record</strong>
          </button>
          <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('meetings')} disabled={!appReady} aria-current={view === 'meetings' ? 'page' : undefined}>
            <strong>Meetings</strong>
          </button>
          <button className={view === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('settings')} disabled={!appReady} aria-current={view === 'settings' ? 'page' : undefined}>
            <strong>Local AI</strong>
          </button>
        </nav>
      </div>
    </aside>
  )
}
