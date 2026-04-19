import { onboardingErrorView, onboardingMessageView, onboardingPhaseLabel, onboardingStatusTone, type OnboardingStatus } from './local-ai-contract'

type RecordingState = Awaited<ReturnType<typeof window.gappd.recording.getStatus>>
type View = 'record' | 'meetings' | 'settings'

type AppSidebarProps = {
  onboarding: OnboardingStatus
  recording: RecordingState
  view: View
  onViewChange: (view: View) => void
}

function progressSummary(status: OnboardingStatus): string | null {
  if (typeof status.progress !== 'number' || status.phase === 'ready') return null
  return `${Math.max(0, Math.min(100, status.progress))}% complete`
}

function statusSummary(status: OnboardingStatus): string | null {
  const progress = progressSummary(status)
  const message = onboardingMessageView(status)?.compact
  if (!progress) return message || null
  return message ? `${progress} · ${message}` : progress
}

export function AppSidebar({ onboarding, recording, view, onViewChange }: AppSidebarProps) {
  const errorView = onboardingErrorView(onboarding)
  const summary = errorView ? null : statusSummary(onboarding)
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-caption">Workspace</div>
        <div className="brand">Gappd</div>
        <div className="subtitle">Desktop meeting recorder</div>
      </div>

      {onboarding.phase === 'ready' ? (
        <div className="sidebar-section">
          <div className="sidebar-nav-label">Navigation</div>
          <nav className="nav">
            <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('record')} aria-current={view === 'record' ? 'page' : undefined}>
              <strong>Record</strong>
              <span>Start, stop, and monitor capture.</span>
            </button>
            <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('meetings')} aria-current={view === 'meetings' ? 'page' : undefined}>
              <strong>Meetings</strong>
              <span>Review summaries and transcripts.</span>
            </button>
            <button className={view === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('settings')} aria-current={view === 'settings' ? 'page' : undefined}>
              <strong>Settings</strong>
              <span>Check local AI runtime health.</span>
            </button>
          </nav>
        </div>
      ) : (
        <div className="sidebar-section">
          <div className="sidebar-nav-label">Navigation</div>
          <nav className="nav">
            <div className="nav-btn active nav-current" aria-current="page">
              <strong>Setup</strong>
              <span>Finish local AI before recording.</span>
            </div>
          </nav>
        </div>
      )}

      <div className="status-card">
        <div className="sidebar-card-head">
          <div>
            <div className="label">Local AI</div>
            <div className="sidebar-summary">Managed runtime status and model details.</div>
          </div>
          <div className={`status-pill ${onboardingStatusTone(onboarding.phase)}`}>{onboardingPhaseLabel(onboarding.phase)}</div>
        </div>
        <div className="sidebar-card-body sidebar-meta">
          {onboarding.model ? <div className="muted">{onboarding.model}</div> : null}
          {summary ? <div className="muted">{summary}</div> : null}
          {onboarding.phase === 'ready' && onboarding.endpoint ? <div className="muted">{onboarding.endpoint}</div> : null}
        </div>
        {errorView ? <div className="error-text">{errorView.compact}</div> : null}
      </div>

      {onboarding.phase === 'ready' ? (
        <div className="status-card">
          <div className="sidebar-card-head">
            <div>
              <div className="label">Recorder</div>
              <div className="sidebar-summary">Current capture session and handoff state.</div>
            </div>
            <div className={`status-pill ${recording.status}`}>{recording.status}</div>
          </div>
          <div className="sidebar-card-body sidebar-meta">
            {recording.title ? <div className="muted">{recording.title}</div> : <div className="muted">No meeting is active.</div>}
            {recording.meetingId ? <div className="muted">{recording.meetingId}</div> : null}
          </div>
          {recording.error ? <div className="error-text">{recording.error}</div> : null}
        </div>
      ) : null}
    </aside>
  )
}
