import '../components/local-ai.css'

import { type ReactNode, useEffect, useState } from 'react'
import type { AIProviderStatus, PiAuthEvent, PiModelOption, StartupSettings } from '../../shared/ipc-contract'
import { Button, Card, cx, StatusPill } from '../components/ui'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'
import { AlertCircleIcon, InfoIcon, RefreshIcon } from '../components/icons'
import { runtimeErrorView, runtimeOperationLabel, runtimeStatusTone, type ManagedRuntimeSnapshot } from '../components/managed-runtime-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type SettingsViewProps = {
  language: string
  onLanguageChange: (language: string) => void
  localAI: { status: ManagedRuntimeSnapshot | null; loading: boolean; busy: boolean; onRepair: () => void }
  developerDebugEnabled: boolean
}

export function SettingsView({ language, onLanguageChange, localAI, developerDebugEnabled }: SettingsViewProps) {
  return <section className="settings-stack settings-stack-plain"><StartupPanel /><AIProviderPanel /><AppleSpeechPanel language={language} onLanguageChange={onLanguageChange} />{developerDebugEnabled ? <LocalAIDebug {...localAI} /> : null}</section>
}

function AIProviderPanel() {
  const [status, setStatus] = useState<AIProviderStatus | null>(null)
  const [draftProvider, setDraftProvider] = useState('')
  const [draftModel, setDraftModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [authEvent, setAuthEvent] = useState<PiAuthEvent | null>(null)
  const [authValue, setAuthValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.gappd.aiProvider.status().then(setStatus).catch((cause) => setError(errorMessage(cause))) }, [])
  useEffect(() => window.gappd.aiProvider.onAuthEvent(setAuthEvent), [])
  const provider = draftProvider || status?.provider || status?.models[0]?.provider || ''
  const models = status?.models.filter((item) => item.provider === provider) ?? []
  const model = draftModel || (status?.provider === provider ? status.model : '') || models[0]?.id || ''
  const authTypes = models.find((item) => item.id === model)?.authTypes ?? []
  const done = () => { setApiKey(''); setAuthEvent(null); setAuthValue('') }
  const run = (action: () => Promise<AIProviderStatus>) => runProviderAction(action, setStatus, setBusy, setError, done)
  return <Card className="settings-section"><SectionTitle title="Meeting summaries" note="Choose where transcript text is processed." action={<StatusPill tone={status?.selected && !status.configured ? 'danger' : 'success'}>{providerStatusLabel(status)}</StatusPill>} /><div className="settings-grid"><div className="metric-card"><label className="label" htmlFor="ai-provider">Pi provider</label><select id="ai-provider" className="settings-select" value={provider} onChange={(event) => selectProvider(event.target.value, status, setDraftProvider, setDraftModel)}>{providerOptions(status?.models ?? []).map((item) => <option key={item.provider} value={item.provider}>{item.providerName}</option>)}</select></div><div className="metric-card"><label className="label" htmlFor="ai-model">Model</label><select id="ai-model" className="settings-select" value={model} onChange={(event) => setDraftModel(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{authTypes.includes('api_key') ? <div className="metric-card"><label className="label" htmlFor="ai-key">API key</label><input id="ai-key" className="settings-select" type="password" autoComplete="off" value={apiKey} placeholder={status?.configured ? 'Stored securely' : 'Required'} onChange={(event) => setApiKey(event.target.value)} /></div> : null}</div><div className={cx('status-note', error ? 'danger' : undefined)}>{error || providerNote(status)}</div>{authEvent ? <PiAuthStep event={authEvent} value={authValue} setValue={setAuthValue} done={() => setAuthEvent(null)} /> : null}<div className="actions-row">{authTypes.includes('api_key') ? <Button variant="primary" disabled={busy || !provider || !model} onClick={() => void run(() => window.gappd.aiProvider.configurePi({ provider, model, apiKey: apiKey || undefined }))}>{busy ? 'Saving…' : 'Use API key'}</Button> : null}{authTypes.includes('oauth') ? <Button variant={authTypes.includes('api_key') ? 'secondary' : 'primary'} disabled={busy || !provider || !model} onClick={() => void run(() => window.gappd.aiProvider.configurePiOAuth({ provider, model }))}>{busy ? 'Signing in…' : 'Sign in'}</Button> : null}<Button onClick={() => void run(() => window.gappd.aiProvider.useLocal())} disabled={busy || !status?.selected}>Use Local AI</Button>{status?.configured ? <Button onClick={() => void run(() => window.gappd.aiProvider.clearPiCredential(status.provider))} disabled={busy}>Forget credential</Button> : null}</div></Card>
}

function PiAuthStep({ event, value, setValue, done }: { event: PiAuthEvent; value: string; setValue: (value: string) => void; done: () => void }) {
  if (event.type === 'notice') return <div className="status-note">{event.message}{event.userCode ? ` Code: ${event.userCode}` : ''}</div>
  const prompt = event.prompt
  const answer = async (cancelled = false) => { await window.gappd.aiProvider.answerPiAuth({ id: prompt.id, value: cancelled ? undefined : value, cancelled }); done(); setValue('') }
  return <div className="metric-card"><label className="label" htmlFor="pi-auth-answer">{prompt.message}</label>{prompt.type === 'select' ? <select id="pi-auth-answer" className="settings-select" value={value} onChange={(item) => setValue(item.target.value)}><option value="">Choose…</option>{prompt.options?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <input id="pi-auth-answer" className="settings-select" type={prompt.type === 'secret' ? 'password' : 'text'} value={value} placeholder={prompt.placeholder} onChange={(item) => setValue(item.target.value)} />}<div className="actions-row"><Button variant="primary" disabled={!value} onClick={() => void answer()}>Continue</Button><Button onClick={() => void answer(true)}>Cancel</Button></div></div>
}

async function runProviderAction(action: () => Promise<AIProviderStatus>, setStatus: (status: AIProviderStatus) => void, setBusy: (busy: boolean) => void, setError: (error: string | null) => void, done: () => void) {
  setBusy(true); setError(null)
  try { setStatus(await action()); done() }
  catch (cause) { setError(errorMessage(cause)) }
  finally { setBusy(false) }
}

function providerOptions(models: PiModelOption[]): PiModelOption[] {
  return models.filter((item, index) => models.findIndex((candidate) => candidate.provider === item.provider) === index)
}

function selectProvider(provider: string, status: AIProviderStatus | null, setProvider: (value: string) => void, setModel: (value: string) => void): void {
  setProvider(provider)
  setModel(status?.models.find((item) => item.provider === provider)?.id ?? '')
}

function providerStatusLabel(status: AIProviderStatus | null): string {
  if (!status) return 'Checking'
  if (!status.selected) return 'Local'
  return status.configured ? 'Pi ready' : 'Setup required'
}

function providerNote(status: AIProviderStatus | null): string {
  if (!status) return 'Checking bundled Pi providers…'
  if (!status.selected) return 'Local AI keeps transcript text on this Mac.'
  if (!status.configured) return 'Pi setup required. Summaries stay pending until credential is saved.'
  return `Transcript text is sent to ${status.provider}; recorded audio stays on this Mac.`
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
