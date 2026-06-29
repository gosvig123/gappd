import '../components/local-ai.css'

import type { ReactNode } from 'react'
import type { TranscriptionSettings, WhisperModelDownloadProgress, WhisperModelSettings } from '../../shared/ipc-contract'
import { Button, Card, cx, ProgressBar, StatusPill } from '../components/ui'
import { AlertCircleIcon, CheckIcon, CircleCheckIcon, DownloadIcon, InfoIcon, RefreshIcon } from '../components/icons'
import { localAISetupErrorView, localAISetupPhaseLabel, localAISetupStatusTone, type LocalAIStatus } from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type SettingsViewProps = {
  localAI: { status: LocalAIStatus | null; loading: boolean; busy: boolean; onRepair: () => void }
  transcription: TranscriptionViewModel
  developerDebugEnabled: boolean
}

type TranscriptionViewModel = {
  settings: TranscriptionSettings | null
  loading: boolean
  busyModelId: string | null
  error: string | null
  progress: WhisperModelDownloadProgress | null
  download: (id: string) => Promise<void> | void
  setDefault: (id: string) => Promise<void> | void
}

export function SettingsView({ localAI, transcription, developerDebugEnabled }: SettingsViewProps) {
  return (
    <section className="settings-stack settings-stack-plain">
      <TranscriptionSettingsPanel state={transcription} />
      {developerDebugEnabled ? <LocalAIDebug {...localAI} /> : null}
    </section>
  )
}

function TranscriptionSettingsPanel({ state }: { state: TranscriptionViewModel }) {
  const models = state.settings?.models ?? []
  return <Card className="settings-section"><SectionTitle title="Transcription model" note="The model marked In use transcribes your meetings. Larger models are more accurate but slower and use more memory." />{state.error ? <div className="status-note danger">{state.error}</div> : null}<div className="settings-model-list">{models.map((model) => <ModelRow key={model.id} model={model} state={state} />)}</div>{state.loading ? <div className="status-note">Loading speech models…</div> : null}</Card>
}

function ModelRow({ model, state }: { model: WhisperModelSettings; state: TranscriptionViewModel }) {
  const selected = state.settings?.defaultModelId === model.id
  const busy = state.busyModelId === model.id
  const progress = busy ? state.progress : null
  return <div className={cx('settings-model-row', selected && 'selected', !model.installed && 'not-installed')}><div className="settings-model-head"><span className={cx('settings-model-marker', selected && 'selected', model.installed && 'installed')} aria-hidden="true">{selected ? <CheckIcon /> : null}</span><div className="settings-model-heading"><strong>{model.label}</strong><ModelStatusPill selected={selected} installed={model.installed} /></div><ModelActions model={model} selected={selected} busy={busy} state={state} /></div><p>{model.description}</p><div className="settings-model-meta"><span className="settings-model-tag">{model.languageSupport}</span><span className={cx('settings-model-tag', 'is-mono')}>{model.sizeMB} MB</span></div>{progress ? <DownloadProgress progress={progress} /> : null}</div>
}

function ModelStatusPill({ selected, installed }: { selected: boolean; installed: boolean }) {
  if (selected) return <CircleCheckIcon className="settings-model-in-use" aria-label="In use" />
  if (installed) return <span className="settings-model-tag is-installed">Installed</span>
  return <span className="settings-model-tag is-not-installed">Not installed</span>
}

function ModelActions({ model, selected, busy, state }: { model: WhisperModelSettings; selected: boolean; busy: boolean; state: TranscriptionViewModel }) {
  if (!model.installed) return <Button variant="primary" className="settings-model-download" onClick={() => state.download(model.id)} disabled={Boolean(state.busyModelId)}>{busy ? progressLabel(state.progress) : <><DownloadIcon className="settings-model-download-icon" />Download</>}</Button>
  if (selected) return null
  return <Button variant="primary" onClick={() => state.setDefault(model.id)} disabled={Boolean(state.busyModelId)}>Use this model</Button>
}

function DownloadProgress({ progress }: { progress: WhisperModelDownloadProgress }) {
  const value = Number.isFinite(progress.progress) ? progress.progress ?? null : null
  return <div className="settings-model-progress"><ProgressBar value={value} label={progress.message} /><span className="settings-model-progress-text">{progress.message}{typeof progress.progress === 'number' ? <span className="settings-model-progress-pct"> · {progress.progress}%</span> : '…'}</span></div>
}

function progressLabel(progress: WhisperModelDownloadProgress | null): string {
  if (progress?.phase === 'verifying') return 'Verifying…'
  if (progress?.phase === 'complete') return 'Done'
  return typeof progress?.progress === 'number' ? `${progress.progress}%` : 'Downloading…'
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
