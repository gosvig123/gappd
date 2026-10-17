import './notes-provider.css'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowLeftRight, Cloud, Download, Laptop, Lock, Send, SlidersHorizontal, UserRound, WifiOff } from 'lucide-react'
import type { AgentId, AgentInstall, AgentModelCatalog, AIProviderStatus } from '../../../shared/ipc-contract'
import { AGENTS, agentInfo, type AgentInfo } from '../../../shared/agents'
import { agentModelName, agentSelectionIsUnavailable, agentSelectionIsValid, defaultAgentSelection, defaultEffortForModel } from '../../../shared/agent-models'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT } from '../../../shared/managed-local-ai'
import { type AgentCatalogState, useAgentCatalog } from '../../hooks/use-agent-catalog'
import { type AgentInstallsState, useAgentInstalls } from '../../hooks/use-agent-installs'
import { Button, Card, cx, ProgressBar, StatusPill } from '../ui'
import { AlertCircleIcon } from '../icons'
import { AgentModelPicker } from './agent-model-picker'
import { LocalAIErrorBanner } from './local-ai-error-banner'
import { runtimeErrorView, type ManagedRuntimeSnapshot } from './managed-runtime-contract'

type Provider = AIProviderStatus['provider']
type Readiness = { tone: string; label: string; progress?: number | null }
type Props = { runtime: ManagedRuntimeSnapshot | null; onRepair: () => void }
type Selection = { model: string; effort: string }

const LOCAL = 'local' satisfies Provider
const MODEL_SIZE = `${(MANAGED_LLAMACPP_MODEL_ARTIFACT.size / 1e9).toFixed(1)} GB`
const SETTING_UP: ManagedRuntimeSnapshot['operation'][] = ['starting_runtime', 'pulling_model', 'saving_config']

/** Settings section that chooses where Meeting notes are made: Local AI on this Mac or an installed agent. */
export function NotesProviderPanel({ runtime, onRepair }: Props) {
  const [status, setStatus] = useState<AIProviderStatus | null>(null)
  const [choice, setChoice] = useState<Provider>(LOCAL)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const found = useAgentInstalls(true)
  const agent = choice === LOCAL ? null : choice
  const install = agent ? installFor(found.installs, agent) : null
  const executable = install?.executable ?? ''
  const catalog = useAgentCatalog(agent, executable)
  useEffect(() => {
    window.gappd.aiProvider.status()
      .then((next) => { setStatus(next); setChoice(next.provider); setModel(next.agentModel); setEffort(next.agentReasoningEffort) })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  }, [])
  useDefaultAgentSelection(catalog.catalog, model, setModel, setEffort)

  const saved = savedAgentSelection(status, choice, catalog.catalog)
  const switching = status !== null && choice !== status.provider
  const modelChanged = agent !== null && status?.provider === agent && (model !== saved.model || effort !== saved.effort)
  const localNeedsSetup = status?.provider === LOCAL && choice === LOCAL && runtime?.operation === 'needs_setup'
  const agentUsable = Boolean(executable && install?.signedIn && agentSelectionIsValid(catalog.catalog, model, effort))
  // Each agent has its own catalog, so a new choice starts from its saved or default selection.
  const choose = (next: Provider) => {
    setChoice(next); setError(null)
    const keep = next !== LOCAL && next === status?.provider
    setModel(keep ? status.agentModel : ''); setEffort(keep ? status.agentReasoningEffort : '')
  }
  const save = async () => {
    setBusy(true); setError(null)
    try { setStatus(agent ? await window.gappd.aiProvider.configureAgent({ agent, executable, model, reasoningEffort: effort }) : await window.gappd.aiProvider.useLocal()) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const cancel = () => {
    if (status) choose(status.provider)
  }
  const header = headerStatus(status, runtime, loading)
  const agentBlocked = agent !== null && !install?.signedIn
  const pending = (switching || modelChanged || localNeedsSetup) && !agentBlocked
  const shown = shownAgents(found.installs, status?.provider ?? LOCAL)
  const missing = found.installs ? AGENTS.filter((info) => !shown.includes(info)) : []

  return (
    <Card className="settings-section notes-provider">
      <div className="settings-section-head">
        <div><h2>Meeting notes</h2><p>Pick where Gappd turns each transcript into a summary, decisions, and action items.</p></div>
        <StatusPill tone={header.tone}>{header.label}</StatusPill>
      </div>
      <div className="notes-cards" role="radiogroup" aria-label="Where notes are made">
        <ProviderCard id={LOCAL} choice={choice} inUse={status?.provider === LOCAL && runtime?.operation !== 'needs_setup'} disabled={loading || busy} onChoose={choose}
          icon={<Laptop />} title="On this Mac" tagline="Private · works offline" readiness={localReadiness(runtime, status?.provider === LOCAL)} meta={MANAGED_LLAMACPP_MODEL_ARTIFACT.label}
          facts={[
            { icon: <Lock />, good: true, text: 'Transcripts and notes stay on this Mac' },
            { icon: <WifiOff />, good: true, text: 'Works without internet' },
            { icon: <Download />, good: false, text: runtime?.localModelReady ? `Notes model is on this Mac (${MODEL_SIZE})` : `One-time ${MODEL_SIZE} download` },
          ]} />
        {shown.map((info) => {
          const agentInstall = installFor(found.installs, info.id)
          return (
            <ProviderCard key={info.id} id={info.id} choice={choice} inUse={status?.provider === info.id} disabled={loading || busy} onChoose={choose}
              icon={<Cloud />} title={`With ${info.name}`} tagline={info.tagline} readiness={agentReadiness(info, found, agentInstall, status)} meta={agentInstall?.version ?? ''}
              facts={[
                { icon: <UserRound />, good: true, text: info.account },
                { icon: <SlidersHorizontal />, good: true, text: 'Choose the model and reasoning effort' },
                { icon: <Send />, good: false, text: info.sendsTo },
              ]} />
          )
        })}
      </div>
      {found.checking && !found.installs ? <p className="notes-footnote">Looking for {nameList(AGENTS)} on this Mac…</p> : null}
      {missing.length && !found.checking ? <p className="notes-footnote">Gappd also works with {nameList(missing)}. Install one and Gappd finds it here. <button type="button" className="notes-link" onClick={found.recheck}>Check again</button></p> : null}
      {agent
        ? <AgentDetails info={agentInfo(agent)} found={found} install={install} catalog={catalog} status={status} model={model} effort={effort} saved={saved} disabled={busy}
            onModelChange={(value) => { setModel(value); setEffort(defaultEffortForModel(catalog.catalog, value)) }} onEffortChange={setEffort} />
        : <LocalDetails runtime={runtime} inUse={status?.provider === LOCAL} onRepair={onRepair} />}
      {error ? <div className="status-note danger">{error}</div> : null}
      {pending ? (
        <div className="notes-change-bar">
          <ArrowLeftRight aria-hidden="true" />
          <span>{changeSummary(agent, runtime, catalog.catalog, model, effort)}</span>
          {switching || modelChanged ? <Button disabled={busy} onClick={cancel}>Cancel</Button> : null}
          <Button variant="primary" disabled={busy || loading || (agent !== null && !agentUsable)} onClick={() => void save()}>
            {busy ? 'Saving…' : changeAction(agent, runtime, switching)}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

/** Agents show when installed, or when saved so a moved install stays visible. */
function shownAgents(installs: AgentInstall[] | null, saved: Provider): AgentInfo[] {
  return AGENTS.filter((info) => info.id === saved || Boolean(installFor(installs, info.id)?.executable))
}

function nameList(infos: readonly AgentInfo[]): string {
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(infos.map((info) => info.name))
}

function installFor(installs: AgentInstall[] | null, agent: AgentId): AgentInstall | null {
  return installs?.find((install) => install.agent === agent) ?? null
}

type Fact = { icon: ReactNode; good: boolean; text: string }
type CardProps = { id: Provider; choice: Provider; inUse: boolean; disabled: boolean; onChoose: (id: Provider) => void; icon: ReactNode; title: string; tagline: string; readiness: Readiness; meta: string; facts: Fact[] }

function ProviderCard({ id, choice, inUse, disabled, onChoose, icon, title, tagline, readiness, meta, facts }: CardProps) {
  return (
    <label className={cx('notes-card', choice === id && 'selected')}>
      <input type="radio" name="notes-provider" value={id} checked={choice === id} disabled={disabled} onChange={() => onChoose(id)} />
      {inUse ? <span className="notes-in-use">In use now</span> : null}
      <span className="notes-card-head">
        <span className={cx('notes-icon-tile', id === LOCAL ? 'local' : 'agent')} aria-hidden="true">{icon}</span>
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

type AgentDetailsProps = {
  info: AgentInfo; found: AgentInstallsState; install: AgentInstall | null; catalog: AgentCatalogState; status: AIProviderStatus | null
  model: string; effort: string; saved: Selection; disabled: boolean
  onModelChange: (model: string) => void; onEffortChange: (effort: string) => void
}

function AgentDetails({ info, found, install, catalog, status, model, effort, saved, disabled, onModelChange, onEffortChange }: AgentDetailsProps) {
  if (found.checking || !found.installs) return <div className="status-note">Looking for {info.name} on this Mac…</div>
  if (!install?.executable) return <Problem text={`${info.name} is not on this Mac. ${info.install}, and Gappd finds it here.`} onRecheck={found.recheck} />
  if (!install.signedIn) return <Problem text={`${info.name} is not signed in. ${info.signIn}, then come back.`} onRecheck={found.recheck} />
  if (catalog.loading) return <div className="status-note">Loading {info.name} models…</div>
  if (catalog.error || !catalog.catalog) return <Problem text={catalog.error || `Could not read the installed ${info.name} model catalog.`} onRecheck={catalog.refresh} />
  const unavailable = status?.provider === info.id && !status.available ? status.error || `${info.name} is unavailable.` : null
  return (
    <div className="notes-details">
      {unavailable ? <div className="status-note danger">{unavailable}</div> : null}
      {agentSelectionIsUnavailable(catalog.catalog, model) ? <div className="status-note danger">The saved model {model} is not in the installed {info.name} model catalog. Choose an available model.</div> : null}
      <AgentModelPicker catalog={catalog.catalog} model={model} effort={effort} savedModel={saved.model} savedEffort={saved.effort} disabled={disabled} onModelChange={onModelChange} onEffortChange={onEffortChange} />
      <p className="notes-footnote">Applies to every Gappd AI task that uses {info.name}. <button type="button" className="notes-link" onClick={catalog.refresh}>Refresh models</button></p>
    </div>
  )
}

function Problem({ text, onRecheck }: { text: string; onRecheck: () => void }) {
  return <div className="notes-problem"><AlertCircleIcon aria-hidden="true" /><span>{text}</span><Button className="compact-action" onClick={onRecheck}>Check again</Button></div>
}

/** An unconfigured agent selects the validated catalog default once the catalog loads. */
function useDefaultAgentSelection(catalog: AgentModelCatalog | null, model: string, setModel: (value: string) => void, setEffort: (value: string) => void) {
  useEffect(() => {
    if (!catalog || model) return
    const selection = defaultAgentSelection(catalog)
    setModel(selection.model)
    setEffort(selection.effort)
  }, [catalog, model, setModel, setEffort])
}

/** An empty saved model means the catalog default, so compare against that default. */
function savedAgentSelection(status: AIProviderStatus | null, choice: Provider, catalog: AgentModelCatalog | null): Selection {
  if (status?.provider === choice && status.agentModel) return { model: status.agentModel, effort: status.agentReasoningEffort }
  return defaultAgentSelection(catalog)
}

function headerStatus(status: AIProviderStatus | null, runtime: ManagedRuntimeSnapshot | null, loading: boolean): Readiness {
  if (!status) return loading ? { tone: 'neutral', label: 'Checking' } : { tone: 'error', label: 'Unknown' }
  if (status.provider !== LOCAL) {
    const name = agentInfo(status.provider).name
    return status.available ? { tone: 'completed', label: `On · ${name}` } : { tone: 'error', label: `${name} unavailable` }
  }
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

function agentReadiness(info: AgentInfo, found: AgentInstallsState, install: AgentInstall | null, status: AIProviderStatus | null): Readiness {
  if (found.checking || !found.installs) return { tone: 'neutral', label: `Looking for ${info.name}` }
  if (!install?.executable) return { tone: 'error', label: 'Not on this Mac' }
  if (!install.signedIn) return { tone: 'error', label: 'Not signed in' }
  if (status?.provider === info.id && !status.available) return { tone: 'error', label: 'Unavailable' }
  return { tone: 'completed', label: 'Signed in' }
}

function changeSummary(agent: AgentId | null, runtime: ManagedRuntimeSnapshot | null, catalog: AgentModelCatalog | null, model: string, effort: string): string {
  if (!agent) return runtime?.localModelReady
    ? 'From now on, Gappd makes notes on this Mac.'
    : `Gappd downloads the notes model once (${MODEL_SIZE}), then makes notes on this Mac. You can keep using Gappd while it downloads.`
  const name = agentModelName(catalog, model)
  return effort ? `From now on, Gappd makes notes with ${name} at ${effort} reasoning effort.` : `From now on, Gappd makes notes with ${name}.`
}

function changeAction(agent: AgentId | null, runtime: ManagedRuntimeSnapshot | null, switching: boolean): string {
  if (!agent) return runtime?.localModelReady ? 'Use this Mac' : `Download ${MODEL_SIZE} and use`
  return switching ? `Use ${agentInfo(agent).name}` : 'Save model'
}

function errorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
}
