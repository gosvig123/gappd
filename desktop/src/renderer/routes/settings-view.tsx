import '../components/local-ai.css'

import { type ReactNode } from 'react'
import { Button, Card, cx, StatusPill } from '../components/ui'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'
import { AlertCircleIcon, InfoIcon, RefreshIcon } from '../components/icons'
import { localAISetupErrorView, localAISetupPhaseLabel, localAISetupStatusTone, type LocalAIStatus } from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type SettingsViewProps = {
  language: string
  onLanguageChange: (language: string) => void
  localAI: { status: LocalAIStatus | null; loading: boolean; busy: boolean; onRepair: () => void }
  developerDebugEnabled: boolean
}

export function SettingsView({ language, onLanguageChange, localAI, developerDebugEnabled }: SettingsViewProps) {
  return <section className="settings-stack settings-stack-plain"><AppleSpeechPanel language={language} onLanguageChange={onLanguageChange} />{developerDebugEnabled ? <LocalAIDebug {...localAI} /> : null}</section>
}

function AppleSpeechPanel({ language, onLanguageChange }: Pick<SettingsViewProps, 'language' | 'onLanguageChange'>) {
  return <Card className="settings-section"><SectionTitle title="Transcription" note="Apple SpeechTranscriber runs on device. This default applies to new meetings." /><div className="settings-grid"><div className="metric-card"><label className="label" htmlFor="transcription-language">Default language</label><select id="transcription-language" className="settings-select" value={language} onChange={(event) => onLanguageChange(event.target.value)}>{TRANSCRIPTION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div><div className="metric-card"><div className="label">Summary language</div><div className="value">Matches transcript</div></div><div className="metric-card"><div className="label">Available options</div><div className="value">{TRANSCRIPTION_LANGUAGES.length}</div></div></div><div className="status-note">English (US) remains the default. Apple-supported availability can vary by macOS language model.</div></Card>
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
