import { MeetingUploadPanel } from '../components/settings/cloud-upload-panel'
import '../components/settings/local-ai.css'

import { type ReactNode, useEffect, useState } from 'react'
import type { AIProviderStatus, CodexModelCatalog, StartupSettings } from '../../shared/ipc-contract'
import { Button, Card, cx, StatusPill } from '../components/ui'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'
import { AlertCircleIcon, InfoIcon, RefreshIcon } from '../components/icons'
import { runtimeErrorView, runtimeOperationLabel, runtimeStatusTone, type ManagedRuntimeSnapshot } from '../components/settings/managed-runtime-contract'
import { SettingsLayout } from '../components/settings/layout'
import { LocalAIErrorBanner } from '../components/settings/local-ai-error-banner'
import { GoogleCalendarPanel } from '../components/settings/google-calendar-panel'
import { SlackPanel } from '../components/slack/panel'
import { COMMUNICATION_CONTEXT_ENABLED } from '../lib/features'
import { CodexModelFields, CodexModelStatus } from '../components/settings/codex-model-fields'
import { codexSelectionIsValid, defaultCodexSelection, defaultEffortForModel } from '../../shared/codex-models'
import { useCodexCatalog } from '../hooks/use-codex-catalog'
import { useCodexInstall } from '../hooks/use-codex-install'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT } from '../../shared/managed-local-ai'
import { THEME_OPTIONS, type ThemeName } from '../hooks/use-theme'
import '../components/atoms.css'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'
import type { SlackConnectionController } from '../hooks/use-slack-connection'

type SettingsViewProps = {
  initialCategory?: string
  language: string
  onLanguageChange: (language: string) => void
  theme: ThemeName
  onThemeChange: (theme: ThemeName) => void
  localAI: { status: ManagedRuntimeSnapshot | null; loading: boolean; busy: boolean; onRepair: () => void }
  calendar: GoogleCalendarController
  slack: SlackConnectionController
  developerDebugEnabled: boolean
}

const LOCAL_PROVIDER = 'local'
const CODEX_PROVIDER = 'codex_exec'
const CODEX_UNAVAILABLE = 'Codex is unavailable'
const LOCAL_MODEL_SIZE = `${(MANAGED_LLAMACPP_MODEL_ARTIFACT.size / 1e9).toFixed(1)} GB`
type SummaryProvider = typeof LOCAL_PROVIDER | typeof CODEX_PROVIDER

export function SettingsView({ language, onLanguageChange, theme, onThemeChange, localAI, calendar, slack, developerDebugEnabled, initialCategory }: SettingsViewProps) {
  const categories = [
    { label: 'General', content: <><AppearancePanel theme={theme} onThemeChange={onThemeChange} /><StartupPanel /></> },
    { label: 'Meeting processing', content: <><AIProviderPanel runtime={localAI.status} /><AppleSpeechPanel language={language} onLanguageChange={onLanguageChange} /></> },
    { label: 'Connections', content: <><GoogleCalendarPanel calendar={calendar} />{COMMUNICATION_CONTEXT_ENABLED ? <SlackPanel slack={slack} /> : null}<MeetingUploadPanel /></> },
  ]
  if (developerDebugEnabled) categories.push({ label: 'Developer Debug', content: <LocalAIDebug {...localAI} /> })
  return <SettingsLayout categories={categories} initialCategory={initialCategory} />
}

function AppearancePanel({ theme, onThemeChange }: { theme: ThemeName; onThemeChange: (theme: ThemeName) => void }) {
  return (
    <Card className="settings-section">
      <SectionTitle title="Appearance" note="Applies to Gappd on this Mac and is remembered between launches." />
      <div className="ui-segmented" role="group" aria-label="Theme">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={theme === option.value}
            className={theme === option.value ? 'ui-segmented-option is-active' : 'ui-segmented-option'}
            onClick={() => onThemeChange(option.value)}
          >{option.label}</button>
        ))}
      </div>
    </Card>
  )
}

function AIProviderPanel({ runtime }: { runtime: ManagedRuntimeSnapshot | null }) {
  const [status, setStatus] = useState<AIProviderStatus | null>(null)
  const [provider, setProvider] = useState<SummaryProvider>(LOCAL_PROVIDER)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const found = useCodexInstall(provider === CODEX_PROVIDER)
  const executable = found.install ? found.install.executable : ''
  const catalog = useCodexCatalog(provider === CODEX_PROVIDER, executable)
  useEffect(() => { void loadProviderStatus(setStatus, setProvider, setModel, setEffort, setError).finally(() => setLoading(false)) }, [])
  useDefaultCodexSelection(catalog.catalog, model, setModel, setEffort)
  const selectionValid = codexSelectionIsValid(catalog.catalog, model, effort)
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const next = provider === LOCAL_PROVIDER ? await window.gappd.aiProvider.useLocal() : await window.gappd.aiProvider.configureCodex({ executable, model, reasoningEffort: effort })
      setStatus(next)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const changeProvider = (next: typeof provider) => { setProvider(next); setStatus(null); setError(null) }
  const healthError = status?.provider === provider && !status.available ? status.error || CODEX_UNAVAILABLE : null
  const shownError = error || healthError
  const notesOn = status?.provider === CODEX_PROVIDER || runtime?.operation === 'ready'
  const note = provider === LOCAL_PROVIDER ? `Private. Transcripts and notes stay on this Mac. If the notes model is not on this Mac yet, Gappd downloads it once (${LOCAL_MODEL_SIZE}).` : 'Uses your ChatGPT account through Codex. Gappd sends transcript text to OpenAI. Recorded audio stays on this Mac.'
  const disabled = loading || busy || catalog.loading || found.checking
  const canSave = !disabled && (provider === LOCAL_PROVIDER || Boolean(executable && found.install?.signedIn) && selectionValid)
  return <Card className="settings-section"><SectionTitle title="Meeting notes" note="Choose where Gappd turns transcripts into notes." action={<StatusPill tone={shownError ? 'danger' : notesOn ? 'success' : 'idle'}>{notesOn || !status ? providerStatusLabel(status) : 'Not set up'}</StatusPill>} /><div className="settings-grid"><div className="metric-card"><label className="label" htmlFor="ai-provider">Notes are made</label><select id="ai-provider" className="settings-select" value={provider} disabled={disabled} onChange={(event) => changeProvider(event.target.value as SummaryProvider)}><option value={LOCAL_PROVIDER}>On this Mac</option><option value={CODEX_PROVIDER}>With Codex</option></select></div>{provider === CODEX_PROVIDER && executable ? <CodexModelFields catalog={catalog} model={model} effort={effort} disabled={disabled} savedModel={status?.codexModel ?? ''} savedEffort={status?.codexReasoningEffort ?? ''} onModelChange={(value) => { setModel(value); setEffort(defaultEffortForModel(catalog.catalog, value)) }} onEffortChange={setEffort} /> : null}</div>{provider === CODEX_PROVIDER ? <CodexModelStatus catalog={catalog} model={model} install={found.install} finding={found.checking} /> : null}<div className={cx('status-note', shownError ? 'danger' : undefined)}>{shownError || note}</div><div className="actions-row"><Button variant="primary" disabled={!canSave} onClick={() => void save()}>{loading || busy ? 'Checking…' : 'Save'}</Button></div></Card>
}

/** Unconfigured Installed Codex selects the validated app default once the catalog loads. */
function useDefaultCodexSelection(catalog: CodexModelCatalog | null, model: string, setModel: (value: string) => void, setEffort: (value: string) => void) {
  useEffect(() => {
    if (!catalog || model) return
    const selection = defaultCodexSelection(catalog)
    setModel(selection.model)
    setEffort(selection.effort)
  }, [catalog, model, setModel, setEffort])
}

async function loadProviderStatus(setStatus: (value: AIProviderStatus) => void, setProvider: (value: SummaryProvider) => void, setModel: (value: string) => void, setEffort: (value: string) => void, setError: (value: string) => void) {
  try {
    const next = await window.gappd.aiProvider.status()
    setStatus(next); setProvider(next.provider); setModel(next.codexModel); setEffort(next.codexReasoningEffort)
  } catch (cause) { setError(errorMessage(cause)) }
}

function providerStatusLabel(status: AIProviderStatus | null): string {
  if (!status) return 'Checking'
  if (status.provider === CODEX_PROVIDER && !status.available) return 'Codex unavailable'
  return status.provider === CODEX_PROVIDER ? 'Codex' : 'On this Mac'
}

function StartupPanel() {
  const [settings, setSettings] = useState<StartupSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => loadStartupSettings(setSettings, setError), [])
  const update = async (enabled: boolean, setting: 'login' | 'speakers' = 'login') => {
    setBusy(true); setError(null)
    try { setSettings(await (setting === 'speakers' ? window.gappd.startup.setSpeakerLabelsEnabled(enabled) : window.gappd.startup.setOpenAtLogin(enabled))) }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <Card className="settings-section"><SectionTitle title="Startup & meetings" note="Defaults for startup and future meetings." /><label className="startup-setting"><span className="startup-setting-copy"><strong>Open Gappd at login</strong><span>Starts in the background. Click Gappd in the Dock to open its window.</span></span><input type="checkbox" checked={settings?.openAtLogin ?? false} disabled={busy || !settings?.supported} onChange={(event) => void update(event.target.checked)} /></label><label className="startup-setting"><span className="startup-setting-copy"><strong>Automatic speaker labels</strong><span>Labels speakers in future meetings. Off affects future meetings only.</span></span><input type="checkbox" checked={settings?.speakerLabelsEnabled ?? true} disabled={busy || !settings} onChange={(event) => void update(event.target.checked, 'speakers')} /></label><div className={cx('status-note', error ? 'danger' : undefined)}>{error || startupNote(settings)}</div></Card>
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
  return <Card className="settings-section"><SectionTitle title="Transcription" note="Apple SpeechTranscriber runs on device. This default applies to new meetings." /><div className="settings-grid"><div className="metric-card"><label className="label" htmlFor="transcription-language">Default language</label><select id="transcription-language" className="settings-select" value={language} onChange={(event) => onLanguageChange(event.target.value)}>{TRANSCRIPTION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div></div><div className="status-note">Summaries use the transcript language. Apple-supported availability can vary by macOS language model.</div></Card>
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
