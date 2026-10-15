import './notes-provider.css'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowLeftRight, Cloud, Download, Laptop, Lock, Send, SlidersHorizontal, UserRound, WifiOff } from 'lucide-react'
import type { AIProviderStatus, CodexModelCatalog } from '../../../shared/ipc-contract'
import { codexSelectionIsUnavailable, codexSelectionIsValid, defaultCodexSelection, defaultEffortForModel } from '../../../shared/codex-models'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT } from '../../../shared/managed-local-ai'
import { type CodexCatalogState, useCodexCatalog } from '../../hooks/use-codex-catalog'
import { type CodexInstallState, useCodexInstall } from '../../hooks/use-codex-install'
import { Button, Card, cx, ProgressBar, StatusPill } from '../ui'
import { AlertCircleIcon } from '../icons'
import { CodexModelPicker } from './codex-model-picker'
import { LocalAIErrorBanner } from './local-ai-error-banner'
import { runtimeErrorView, type ManagedRuntimeSnapshot } from './managed-runtime-contract'

type Provider = AIProviderStatus['provider']
type Readiness = { tone: string; label: string; progress?: number | null }
type Props = { runtime: ManagedRuntimeSnapshot | null; onRepair: () => void }

const LOCAL: Provider = 'local'
const CODEX: Provider = 'codex_exec'
const MODEL_SIZE = `${(MANAGED_LLAMACPP_MODEL_ARTIFACT.size / 1e9).toFixed(1)} GB`
const SETTING_UP: ManagedRuntimeSnapshot['operation'][] = ['starting_runtime', 'pulling_model', 'saving_config']

/** Settings section that chooses where Meeting notes are made: Local AI on this Mac or Installed Codex. */
export function NotesProviderPanel({ runtime, onRepair }: Props) {
  const [status, setStatus] = useState<AIProviderStatus | null>(null)
  const [choice, setChoice] = useState<Provider>(LOCAL)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const found = useCodexInstall(true)
  const executable = found.install?.executable ?? ''
  const catalog = useCodexCatalog(choice === CODEX, executable)
  useEffect(() => {
    window.gappd.aiProvider.status()
      .then((next) => { setStatus(next); setChoice(next.provider); setModel(next.codexModel); setEffort(next.codexReasoningEffort) })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  }, [])
  useDefaultCodexSelection(catalog.catalog, model, setModel, setEffort)

  const saved = savedCodexSelection(status, catalog.catalog)
  const switching = status !== null && choice !== status.provider
  const modelChanged = status?.provider === CODEX && choice === CODEX && (model !== saved.model || effort !== saved.effort)
  const localNeedsSetup = status?.provider === LOCAL && choice === LOCAL && runtime?.operation === 'needs_setup'
  const codexUsable = Boolean(executable && found.install?.signedIn && codexSelectionIsValid(catalog.catalog, model, effort))
  const save = async () => {
    setBusy(true); setError(null)
    try { setStatus(choice === LOCAL ? await window.gappd.aiProvider.useLocal() : await window.gappd.aiProvider.configureCodex({ executable, model, reasoningEffort: effort })) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const cancel = () => {
    if (status) setChoice(status.provider)
    setModel(saved.model); setEffort(saved.effort); setError(null)
  }
  const header = headerStatus(status, runtime, loading)
  const codexBlocked = choice === CODEX && !found.install?.signedIn
  const pending = (switching || modelChanged || localNeedsSetup) && !codexBlocked

  return (
    <Card className="settings-section notes-provider">
      <div className="settings-section-head">
        <div><h2>Meeting notes</h2><p>Pick where Gappd turns each transcript into a summary, decisions, and action items.</p></div>
        <StatusPill tone={header.tone}>{header.label}</StatusPill>
      </div>
      <div className="notes-cards" role="radiogroup" aria-label="Where notes are made">
        <ProviderCard id={LOCAL} choice={choice} inUse={status?.provider === LOCAL && runtime?.operation !== 'needs_setup'} disabled={loading || busy} onChoose={setChoice}
          icon={<Laptop />} title="On this Mac" tagline="Private · works offline" readiness={localReadiness(runtime, status?.provider === LOCAL)} meta={MANAGED_LLAMACPP_MODEL_ARTIFACT.label}
          facts={[
            { icon: <Lock />, good: true, text: 'Transcripts and notes stay on this Mac' },
            { icon: <WifiOff />, good: true, text: 'Works without internet' },
            { icon: <Download />, good: false, text: runtime?.localModelReady ? `Notes model is on this Mac (${MODEL_SIZE})` : `One-time ${MODEL_SIZE} download` },
          ]} />
        <ProviderCard id={CODEX} choice={choice} inUse={status?.provider === CODEX} disabled={loading || busy} onChoose={setChoice}
          icon={<Cloud />} title="With Codex" tagline="Your ChatGPT account · OpenAI" readiness={codexReadiness(found, status)} meta={found.install?.version ?? ''}
          facts={[
            { icon: <UserRound />, good: true, text: 'Uses your ChatGPT account. No download.' },
            { icon: <SlidersHorizontal />, good: true, text: 'Choose the model and reasoning effort' },
            { icon: <Send />, good: false, text: 'Sends transcript text to OpenAI. Audio stays on this Mac.' },
          ]} />
      </div>
      {choice === CODEX
        ? <CodexDetails found={found} catalog={catalog} status={status} model={model} effort={effort} saved={saved} disabled={busy}
            onModelChange={(value) => { setModel(value); setEffort(defaultEffortForModel(catalog.catalog, value)) }} onEffortChange={setEffort} />
        : <LocalDetails runtime={runtime} inUse={status?.provider === LOCAL} onRepair={onRepair} />}
      {error ? <div className="status-note danger">{error}</div> : null}
      {pending ? (
        <div className="notes-change-bar">
          <ArrowLeftRight aria-hidden="true" />
          <span>{changeSummary(choice, runtime, catalog.catalog, model, effort)}</span>
          {switching || modelChanged ? <Button disabled={busy} onClick={cancel}>Cancel</Button> : null}
          <Button variant="primary" disabled={busy || loading || (choice === CODEX && !codexUsable)} onClick={() => void save()}>
            {busy ? 'Saving…' : changeAction(choice, runtime, switching)}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

type Fact = { icon: ReactNode; good: boolean; text: string }
type CardProps = { id: Provider; choice: Provider; inUse: boolean; disabled: boolean; onChoose: (id: Provider) => void; icon: ReactNode; title: string; tagline: string; readiness: Readiness; meta: string; facts: Fact[] }

function ProviderCard({ id, choice, inUse, disabled, onChoose, icon, title, tagline, readiness, meta, facts }: CardProps) {
  return (
    <label className={cx('notes-card', choice === id && 'selected')}>
      <input type="radio" name="notes-provider" value={id} checked={choice === id} disabled={disabled} onChange={() => onChoose(id)} />
      {inUse ? <span className="notes-in-use">In use now</span> : null}
      <span className="notes-card-head">
        <span className={cx('notes-icon-tile', id === LOCAL ? 'local' : 'codex')} aria-hidden="true">{icon}</span>
        <span><strong>{title}</strong><small>{tagline}</small></span>
        <span className="notes-radio" aria-hidden="true" />
      </span>
      <ul className="notes-facts">
        {facts.map((fact) => <li key={fact.text} className={fact.good ? 'good' : 'heads-up'}><span aria-hidden="true">{fact.icon}</span>{fact.text}</li>)}
      </ul>
      <span className="notes-card-foot">
        <span className="notes-card-status"><StatusPill tone={readiness.tone}>{readiness.label}</StatusPill><code title={meta}>{meta}</code></span>
        {readiness.progress !== undefined ? <ProgressBar value={readiness.progress} label={`${title} setup progress`} /> : null}
      </span>
    </label>
  )
}

function LocalDetails({ runtime, inUse, onRepair }: { runtime: ManagedRuntimeSnapshot | null; inUse: boolean; onRepair: () => void }) {
  if (!inUse || !runtime) return null
  if (SETTING_UP.includes(runtime.operation)) return <div className="status-note">{runtime.message} You can keep using Gappd while this runs.</div>
  if (runtime.operation !== 'error') return null
  const errorView = runtimeErrorView(runtime)
  return (
    <div className="notes-details">
      {errorView ? <LocalAIErrorBanner errorView={errorView} /> : <div className="status-note danger">{runtime.error || runtime.message}</div>}
      {runtime.canRepair ? <div><Button onClick={onRepair}>Try again</Button></div> : null}
    </div>
  )
}

type CodexDetailsProps = {
  found: CodexInstallState; catalog: CodexCatalogState; status: AIProviderStatus | null
  model: string; effort: string; saved: { model: string; effort: string }; disabled: boolean
  onModelChange: (model: string) => void; onEffortChange: (effort: string) => void
}

function CodexDetails({ found, catalog, status, model, effort, saved, disabled, onModelChange, onEffortChange }: CodexDetailsProps) {
  const install = found.install
  if (found.checking || !install) return <div className="status-note">Looking for Codex on this Mac…</div>
  if (!install.executable) return <Problem text="Codex is not on this Mac. Install the ChatGPT app or Codex, and Gappd finds it here." onRecheck={found.recheck} />
  if (!install.signedIn) return <Problem text="Codex is not signed in. Open the ChatGPT app or Codex and sign in, then come back." onRecheck={found.recheck} />
  if (catalog.loading) return <div className="status-note">Loading Codex models…</div>
  if (catalog.error || !catalog.catalog) return <Problem text={catalog.error || 'Could not read the installed Codex model catalog.'} onRecheck={catalog.refresh} />
  const unavailable = status?.provider === CODEX && !status.available ? status.error || 'Codex is unavailable.' : null
  return (
    <div className="notes-details">
      {unavailable ? <div className="status-note danger">{unavailable}</div> : null}
      {codexSelectionIsUnavailable(catalog.catalog, model) ? <div className="status-note danger">The saved model {model} is not in the installed Codex model catalog. Choose an available model.</div> : null}
      <CodexModelPicker catalog={catalog.catalog} model={model} effort={effort} savedModel={saved.model} savedEffort={saved.effort} disabled={disabled} onModelChange={onModelChange} onEffortChange={onEffortChange} />
      <p className="notes-footnote">Applies to every Gappd AI task that uses Codex. <button type="button" className="notes-link" onClick={catalog.refresh}>Refresh models</button></p>
    </div>
  )
}

function Problem({ text, onRecheck }: { text: string; onRecheck: () => void }) {
  return <div className="notes-problem"><AlertCircleIcon aria-hidden="true" /><span>{text}</span><Button className="compact-action" onClick={onRecheck}>Check again</Button></div>
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

/** An empty saved model means the app default, so compare against that default. */
function savedCodexSelection(status: AIProviderStatus | null, catalog: CodexModelCatalog | null): { model: string; effort: string } {
  if (status?.codexModel) return { model: status.codexModel, effort: status.codexReasoningEffort }
  return defaultCodexSelection(catalog)
}

function headerStatus(status: AIProviderStatus | null, runtime: ManagedRuntimeSnapshot | null, loading: boolean): Readiness {
  if (!status) return loading ? { tone: 'neutral', label: 'Checking' } : { tone: 'error', label: 'Unknown' }
  if (status.provider === CODEX) return status.available ? { tone: 'completed', label: 'On · Codex' } : { tone: 'error', label: 'Codex unavailable' }
  if (!runtime) return { tone: 'neutral', label: 'Checking' }
  if (runtime.operation === 'ready') return { tone: 'completed', label: 'On · This Mac' }
  if (SETTING_UP.includes(runtime.operation)) return { tone: 'processing', label: 'Setting up' }
  if (runtime.operation === 'error') return { tone: 'error', label: 'Needs attention' }
  return { tone: 'neutral', label: 'Not set up' }
}

function localReadiness(runtime: ManagedRuntimeSnapshot | null, inUse: boolean): Readiness {
  if (!runtime) return { tone: 'neutral', label: 'Checking' }
  if (inUse && SETTING_UP.includes(runtime.operation)) {
    const progress = typeof runtime.progress === 'number' ? Math.round(runtime.progress) : null
    const step = runtime.operation === 'pulling_model' ? 'Downloading' : runtime.operation === 'saving_config' ? 'Finishing' : 'Starting'
    return { tone: 'processing', label: progress === null ? step : `${step} · ${progress}%`, progress }
  }
  if (inUse && runtime.operation === 'error') return { tone: 'error', label: 'Needs attention' }
  if (runtime.localModelReady) return { tone: 'completed', label: 'Model ready' }
  return { tone: 'neutral', label: `Needs ${MODEL_SIZE} download` }
}

function codexReadiness(found: CodexInstallState, status: AIProviderStatus | null): Readiness {
  if (found.checking || !found.install) return { tone: 'neutral', label: 'Looking for Codex' }
  if (!found.install.executable) return { tone: 'error', label: 'Not on this Mac' }
  if (!found.install.signedIn) return { tone: 'error', label: 'Not signed in' }
  if (status?.provider === CODEX && !status.available) return { tone: 'error', label: 'Unavailable' }
  return { tone: 'completed', label: 'Signed in' }
}

function changeSummary(choice: Provider, runtime: ManagedRuntimeSnapshot | null, catalog: CodexModelCatalog | null, model: string, effort: string): string {
  if (choice === LOCAL) return runtime?.localModelReady
    ? 'From now on, Gappd makes notes on this Mac.'
    : `Gappd downloads the notes model once (${MODEL_SIZE}), then makes notes on this Mac. You can keep using Gappd while it downloads.`
  const name = catalog?.models.find((option) => option.id === model)?.displayName || model
  return `From now on, Gappd makes notes with ${name} at ${effort} reasoning effort.`
}

function changeAction(choice: Provider, runtime: ManagedRuntimeSnapshot | null, switching: boolean): string {
  if (choice === LOCAL) return runtime?.localModelReady ? 'Use this Mac' : `Download ${MODEL_SIZE} and use`
  return switching ? 'Use Codex' : 'Save model'
}

function errorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
}
