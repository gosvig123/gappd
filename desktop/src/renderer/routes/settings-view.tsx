import '../components/local-ai.css'

import { type ReactNode, useEffect, useState } from 'react'
import type { AIProviderStatus, StartupSettings } from '../../shared/ipc-contract'
import { Button, Card, cx, StatusPill } from '../components/ui'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'
import { AlertCircleIcon, InfoIcon, RefreshIcon } from '../components/icons'
import { runtimeErrorView, runtimeOperationLabel, runtimeStatusTone, type ManagedRuntimeSnapshot } from '../components/managed-runtime-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'
import { GoogleCalendarPanel } from '../components/google-calendar-panel'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'

type SettingsViewProps = {
  language: string
  onLanguageChange: (language: string) => void
  localAI: { status: ManagedRuntimeSnapshot | null; loading: boolean; busy: boolean; onRepair: () => void }
  calendar: GoogleCalendarController
  developerDebugEnabled: boolean
}

const LOCAL_PROVIDER = 'local'
const CODEX_PROVIDER = 'codex_exec'
const CODEX_UNAVAILABLE = 'Installed Codex is unavailable'
type SummaryProvider = typeof LOCAL_PROVIDER | typeof CODEX_PROVIDER

export function SettingsView({ language, onLanguageChange, localAI, calendar, developerDebugEnabled }: SettingsViewProps) {
  return <section className="settings-stack settings-stack-plain"><StartupPanel /><GoogleCalendarPanel calendar={calendar} /><AIProviderPanel /><AppleSpeechPanel language={language} onLanguageChange={onLanguageChange} />{developerDebugEnabled ? <LocalAIDebug {...localAI} /> : null}</section>
}

function AIProviderPanel() {
  const [status, setStatus] = useState<AIProviderStatus | null>(null)
  const [provider, setProvider] = useState<SummaryProvider>(LOCAL_PROVIDER)
  const [executable, setExecutable] = useState('')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void loadProviderStatus(setStatus, setProvider, setExecutable, setModel, setError).finally(() => setLoading(false)) }, [])
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const next = provider === LOCAL_PROVIDER ? await window.gappd.aiProvider.useLocal() : await window.gappd.aiProvider.configureCodex({ executable, model })
      setStatus(next)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const changeProvider = (next: typeof provider) => { setProvider(next); setStatus(null); setError(null) }
  const healthError = status?.provider === provider && !status.available ? status.error || CODEX_UNAVAILABLE : null
  const shownError = error || healthError
  const note = provider === LOCAL_PROVIDER ? 'Local AI keeps transcript text and audio on this Mac.' : 'Uses existing Codex login and current Codex CLI. Update Codex if check fails. Transcript text goes through Codex; recorded audio stays on this Mac.'
  return <Card className="settings-section"><SectionTitle title="Meeting summaries" note="Choose where transcript text is processed." action={<StatusPill tone={shownError ? 'danger' : 'success'}>{providerStatusLabel(status)}</StatusPill>} /><div className="settings-grid"><div className="metric-card"><label className="label" htmlFor="ai-provider">Provider</label><select id="ai-provider" className="settings-select" value={provider} disabled={loading || busy} onChange={(event) => changeProvider(event.target.value as SummaryProvider)}><option value={LOCAL_PROVIDER}>Local AI</option><option value={CODEX_PROVIDER}>Installed Codex</option></select></div>{provider === CODEX_PROVIDER ? <><div className="metric-card"><label className="label" htmlFor="codex-executable">Codex executable</label><input id="codex-executable" className="settings-select" value={executable} disabled={loading || busy} placeholder="/absolute/path/to/codex" onChange={(event) => setExecutable(event.target.value)} /></div><div className="metric-card"><label className="label" htmlFor="codex-model">Model (optional)</label><input id="codex-model" className="settings-select" value={model} disabled={loading || busy} onChange={(event) => setModel(event.target.value)} /></div></> : null}</div><div className={cx('status-note', shownError ? 'danger' : undefined)}>{shownError || note}</div><div className="actions-row"><Button variant="primary" disabled={loading || busy || (provider === CODEX_PROVIDER && !executable.trim())} onClick={() => void save()}>{loading || busy ? 'Checking…' : 'Save summary provider'}</Button></div></Card>
}

async function loadProviderStatus(setStatus: (value: AIProviderStatus) => void, setProvider: (value: SummaryProvider) => void, setExecutable: (value: string) => void, setModel: (value: string) => void, setError: (value: string) => void) {
  try {
    const next = await window.gappd.aiProvider.status()
    setStatus(next); setProvider(next.provider); setExecutable(next.codexExecutable); setModel(next.codexModel)
  } catch (cause) { setError(errorMessage(cause)) }
}

function providerStatusLabel(status: AIProviderStatus | null): string {
  if (!status) return 'Checking'
  if (status.provider === CODEX_PROVIDER && !status.available) return 'Codex unavailable'
  return status.provider === CODEX_PROVIDER ? 'Installed Codex' : 'Local AI'
}

function StartupPanel() {
  const [settings, setSettings] = useState<StartupSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => loadStartupSettings(setSettings, setError), [])
  const update = async (enabled: boolean, speakerLabels = false) => {
    setBusy(true); setError(null)
    try { setSettings(await (speakerLabels ? window.gappd.startup.setSpeakerLabelsEnabled(enabled) : window.gappd.startup.setOpenAtLogin(enabled))) }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <Card className="settings-section"><SectionTitle title="Startup & meetings" note="Defaults for startup and future meetings." /><label className="startup-setting"><span className="startup-setting-copy"><strong>Open Gappd at login</strong><span>Starts in the background. Click Gappd in the Dock to open its window.</span></span><input type="checkbox" checked={settings?.openAtLogin ?? false} disabled={busy || !settings?.supported} onChange={(event) => void update(event.target.checked)} /></label><label className="startup-setting"><span className="startup-setting-copy"><strong>Automatic speaker labels</strong><span>Labels speakers in future meetings. Off affects future meetings only.</span></span><input type="checkbox" checked={settings?.speakerLabelsEnabled ?? true} disabled={busy || !settings} onChange={(event) => void update(event.target.checked, true)} /></label><div className={cx('status-note', error ? 'danger' : undefined)}>{error || startupNote(settings)}</div></Card>
}

function loadStartupSettings(setSettings: (settings: StartupSettings) => void, setError: (error: string) => void) {
  let active = true
  window.gappd.startup.getSettings().then((settings) => { if (active) setSettings(settings) }).catch((cause) => { if (active) setError(errorMessage(cause)) })
  return () => { active = false }
}

function startupNote(settings: StartupSettings | null): string {
  if (!settings) return 'Checking macOS Login Items…'
  if (!settings.supported) return 'Available in packaged macOS builds.'
  if (settings.requiresApproval) return 'macOS requires approval in System Settings → General → Login Items.'
  return settings.openAtLogin ? 'Gappd will start after you sign in.' : 'Gappd will not start after you sign in.'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function AppleSpeechPanel({ language, onLanguageChange }: Pick<SettingsViewProps, 'language' | 'onLanguageChange'>) {
  return <Card className="settings-section"><SectionTitle title="Transcription" note="Apple SpeechTranscriber runs on device. This default applies to new meetings." /><div className="settings-grid"><div className="metric-card"><label className="label" htmlFor="transcription-language">Default language</label><select id="transcription-language" className="settings-select" value={language} onChange={(event) => onLanguageChange(event.target.value)}>{TRANSCRIPTION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div><div className="metric-card"><div className="label">Summary language</div><div className="value">Matches transcript</div></div><div className="metric-card"><div className="label">Available options</div><div className="value">{TRANSCRIPTION_LANGUAGES.length}</div></div></div><div className="status-note">English (US) remains the default. Apple-supported availability can vary by macOS language model.</div></Card>
}

function LocalAIDebug({ status, loading, busy, onRepair }: SettingsViewProps['localAI']) {
  const errorView = runtimeErrorView(status)
  return <Card className={cx('settings-section', 'settings-debug')}><SectionTitle title={<><InfoIcon className="settings-section-icon" aria-hidden="true" /> Developer Debug</>} note="Local AI runtime health for development." action={<StatusPill tone={status ? runtimeStatusTone(status.operation) : 'processing'}>{loading ? 'Checking' : runtimeOperationLabel(status?.operation ?? 'checking')}</StatusPill>} /><div className="settings-grid">{metrics(status).map((metric) => <div className="metric-card" key={metric.label}><div className="label">{metric.label}</div><div className="value">{metric.value}</div></div>)}</div><div className="status-note">{status?.message || 'Check local AI status and repair the managed runtime if needed.'}</div>{errorView ? <div className="settings-debug-alert"><AlertCircleIcon aria-hidden="true" /><span>Needs attention</span></div> : null}{errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}<div className="actions-row"><Button variant="primary" onClick={onRepair} disabled={loading || busy || !status || !status.canRepair}>{busy ? 'Repairing...' : <><RefreshIcon className="settings-repair-icon" /> Repair local AI</>}</Button></div></Card>
}

function SectionTitle({ title, note, action }: { title: ReactNode; note: ReactNode; action?: ReactNode }) {
  return <div className="settings-section-head"><div><h2>{title}</h2><p>{note}</p></div>{action}</div>
}

function metrics(status: ManagedRuntimeSnapshot | null) {
  return [
    { label: 'Supported', value: flagLabel(status, 'supported') },
    { label: 'Configured', value: flagLabel(status, 'configured') },
    { label: 'Bundled', value: flagLabel(status, 'bundled') },
    { label: 'Running', value: flagLabel(status, 'running') },
    { label: 'Model', value: status?.model || 'Unknown' },
    { label: 'Endpoint', value: status?.endpoint || 'Unknown' },
  ]
}

function flagLabel(status: ManagedRuntimeSnapshot | null, key: 'supported' | 'configured' | 'bundled' | 'running'): string {
  if (!status) return 'Unknown'
  return status[key] ? 'Yes' : 'No'
}
