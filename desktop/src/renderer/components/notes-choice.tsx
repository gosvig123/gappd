import { useState, type ReactNode } from 'react'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT } from '../../shared/managed-local-ai'
import type { AgentId, AgentInstall, AIProviderStatus } from '../../shared/ipc-contract'
import { AGENTS, agentInfo } from '../../shared/agents'
import { useAgentInstalls } from '../hooks/use-agent-installs'
import type { AppView } from '../lib/app-view'
import { notesPreparing } from '../lib/setup-steps'
import { errorText } from './person-forms'
import { runtimeErrorView } from './settings/managed-runtime-contract'
import { Button, ProgressBar } from './ui'
import './setup-checklist.css'

const MODEL_SIZE = `${(MANAGED_LLAMACPP_MODEL_ARTIFACT.size / 1e9).toFixed(1)} GB`

export type NotesChoice = { installs: AgentInstall[] | null; finding: boolean; busy: AgentId | null; error: string | null; saved: AIProviderStatus | null; useAgent(install: AgentInstall): void; recheck(): void }

/** Finds the installed agents while the choice is open and saves one with one click. */
export function useNotesChoice(open: boolean): NotesChoice {
  const found = useAgentInstalls(open)
  const [busy, setBusy] = useState<AgentId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<AIProviderStatus | null>(null)
  const useAgent = (install: AgentInstall) => {
    if (!install.executable) return
    setBusy(install.agent); setError(null)
    window.gappd.aiProvider.configureAgent({ agent: install.agent, executable: install.executable, model: '', reasoningEffort: '' })
      .then(setSaved)
      .catch((cause) => setError(`Gappd could not use ${agentInfo(install.agent).name}. ${errorText(cause)}`))
      .finally(() => setBusy(null))
  }
  return { installs: found.installs, finding: found.checking, busy, error, saved, useAgent, recheck: found.recheck }
}

/**
 * Where Gappd makes notes. One option leads: an AI app that is signed in, or else
 * the model on this Mac. The rest wait under "Other options", so most people
 * decide with one click.
 */
export function NotesChoicePanel({ view, choice }: { view: AppView; choice: NotesChoice }) {
  const runtime = view.runtime
  if (notesPreparing(runtime)) return <LocalAiProgress message={runtime?.message} progress={runtime?.progress} />
  const failed = runtime?.operation === 'error'
  const failure = failed ? runtimeErrorView(runtime) : null
  const busy = view.runtimeBusy || choice.busy !== null
  const errors = <>
    {failure ? <p className="setup-step-warning">{failure.title} {failure.detail}</p> : null}
    {choice.error ? <p className="setup-step-warning">{choice.error}</p> : null}
  </>
  if (!choice.installs) return <>{errors}<p className="setup-step-note">Looking for AI apps on this Mac…</p></>
  const found = choice.installs.filter((install) => install.executable)
  // Signed-in agents work now, so they lead; agents that need a sign-in come last.
  const options: Array<AgentInstall | 'local'> = [...found.filter((install) => install.signedIn), 'local', ...found.filter((install) => !install.signedIn)]
  const option = (item: AgentInstall | 'local', lead: boolean) => {
    const variant = lead ? 'primary' : 'secondary'
    if (item === 'local') return <NotesOption key="local" title="On this Mac" points={['Private. Transcripts and notes stay on this Mac.', `One-time ${MODEL_SIZE} download. Works offline.`]}>
      <Button variant={variant} disabled={busy} onClick={failed ? view.actions.repairRuntime : view.actions.setupRuntime}>{failed ? 'Try again' : `Download ${MODEL_SIZE}`}</Button>
    </NotesOption>
    const info = agentInfo(item.agent)
    return <NotesOption key={item.agent} title={info.name} points={item.signedIn ? [info.account, info.sendsTo] : [`Found ${info.name}, but it is not signed in.`, `${info.signIn}, then come back.`]}>
      {item.signedIn
        ? <Button variant={variant} disabled={busy} onClick={() => choice.useAgent(item)}>{choice.busy === item.agent ? `Checking ${info.name}…` : `Use ${info.name}`}</Button>
        : <Button aria-label={`Check ${info.name} sign-in again`} disabled={choice.finding} onClick={choice.recheck}>{choice.finding ? 'Checking…' : 'Check again'}</Button>}
    </NotesOption>
  }
  const [lead, ...others] = options
  return <>
    {errors}
    <div className="setup-choices">{option(lead, true)}</div>
    {others.length ? <details className="notes-choice-more">
      <summary>Other options</summary>
      <div className="setup-choices">{others.map((item) => option(item, false))}</div>
    </details> : null}
    {!found.length ? <p className="setup-step-note">Have {new Intl.ListFormat('en', { type: 'disjunction' }).format(AGENTS.map((agent) => agent.name))}? Install one and Gappd finds it here.</p> : null}
  </>
}

function NotesOption({ title, points, children }: { title: string; points: string[]; children: ReactNode }) {
  return <div className="setup-choice">
    <strong>{title}</strong>
    <ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
    {children}
  </div>
}

function LocalAiProgress({ message, progress }: { message?: string; progress?: number }) {
  const value = typeof progress === 'number' ? Math.round(progress) : null
  return <div className="setup-step-progress">
    <p>{message || 'Preparing Local AI'}{value === null ? '' : ` · ${value}%`}</p>
    <ProgressBar value={value} label="Local AI setup progress" />
    <p className="setup-step-note">You can keep using Gappd while this runs.</p>
  </div>
}
