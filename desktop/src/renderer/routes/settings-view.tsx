import '../components/local-ai.css'

import { type ReactNode } from 'react'
import { Button, Card, cx, StatusPill } from '../components/ui'
import { AlertCircleIcon, InfoIcon, RefreshIcon } from '../components/icons'
import { localAISetupErrorView, localAISetupPhaseLabel, localAISetupStatusTone, type LocalAIStatus } from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type SettingsViewProps = {
  localAI: { status: LocalAIStatus | null; loading: boolean; busy: boolean; onRepair: () => void }
  developerDebugEnabled: boolean
}

export function SettingsView({ localAI, developerDebugEnabled }: SettingsViewProps) {
  return <section className="settings-stack settings-stack-plain"><AppleSpeechPanel />{developerDebugEnabled ? <LocalAIDebug {...localAI} /> : null}</section>
}

function AppleSpeechPanel() {
  return <Card className="settings-section"><SectionTitle title="Transcription" note="Gappd now uses Apple SpeechTranscriber on device. Speech models are managed by macOS, not downloaded by Gappd." /><div className="status-note">Default locale: English (US). Set GAPPD_SPEECH_LOCALE before launch to try another Apple-supported locale.</div></Card>
}

function LocalAIDebug({ status, loading, busy, onRepair }: SettingsViewProps['localAI']) {
  const errorView = localAISetupErrorView(status)
  return <Card className={cx('settings-section', 'settings-debug')}><SectionTitle title={<><InfoIcon className="settings-section-icon" aria-hidden="true" /> Developer Debug</>} note="Local AI runtime health for development." action={<StatusPill tone={status ? localAISetupStatusTone(status.phase) : 'processing'}>{loading ? 'Checking' : localAISetupPhaseLabel(status?.phase ?? 'checking')}</StatusPill>} /><div className="settings-grid">{metrics(status).map((metric) => <div className="metric-card" key={metric.label}><div className="label">{metric.label}</div><div className="value">{metric.value}</div></div>)}</div><div className="status-note">{status?.message || 'Check local AI status and repair the managed runtime if needed.'}</div>{errorView ? <div className="settings-debug-alert"><AlertCircleIcon aria-hidden="true" /><span>Needs attention</span></div> : null}{errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}<div className="actions-row"><Button variant="primary" onClick={onRepair} disabled={loading || busy || !status || !status.canRepair}>{busy ? 'Repairing...' : <><RefreshIcon className="settings-repair-icon" /> Repair local AI</>}</Button></div></Card>
}

function SectionTitle({ title, note, action }: { title: ReactNode; note: ReactNode; action?: ReactNode }) {
  return <div className="settings-section-head"><div><h2>{title}</h2><p>{note}</p></div>{action}</div>
}

function metrics(status: LocalAIStatus | null) {
  return [
    { label: 'Supported', value: flagLabel(status, 'supported') },
    { label: 'Configured', value: flagLabel(status, 'configured') },
    { label: 'Bundled', value: flagLabel(status, 'bundled') },
    { label: 'Running', value: flagLabel(status, 'running') },
    { label: 'Model', value: status?.model || 'Unknown' },
    { label: 'Endpoint', value: status?.endpoint || 'Unknown' },
  ]
}

function flagLabel(status: LocalAIStatus | null, key: 'supported' | 'configured' | 'bundled' | 'running'): string {
  if (!status) return 'Unknown'
  return status[key] ? 'Yes' : 'No'
}
