import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT } from '../../shared/managed-local-ai'
import type { AgentId, AgentInstall, AIProviderStatus } from '../../shared/ipc-contract'
import { AGENTS, agentInfo, isAgentId } from '../../shared/agents'
import { useAgentInstalls } from '../hooks/use-agent-installs'
import { useUsageSharing } from '../hooks/use-usage-sharing'
import type { AppView } from '../lib/app-view'
import { SetupTestRecording } from './setup-test-recording'
import { notesAvailability, setupSteps, setupVisible, type SetupStepState } from '../lib/setup-steps'
import { runtimeErrorView } from './settings/managed-runtime-contract'
import { Button, ProgressBar, cx } from './ui'
import './setup-checklist.css'

const CALENDAR_SKIPPED_KEY = 'gappd.setup.calendarSkipped'
const NOTES_SKIPPED_KEY = 'gappd.setup.notesSkipped'
const FINISHED_SHOWN_KEY = 'gappd.setup.finishedShown'
const MODEL_SIZE = `${(MANAGED_LLAMACPP_MODEL_ARTIFACT.size / 1e9).toFixed(1)} GB`

type ButtonVariant = 'primary' | 'secondary'
type Step = { key: string; title: string; optional?: boolean; state: SetupStepState; detail: ReactNode; actions?: ReactNode }

/**
 * First-run setup, one step at a time. It explains what Gappd records before
 * macOS asks, and it leaves once every step that applies is done or skipped.
 */
export function SetupChecklist({ view }: { view: AppView }) {
  const [calendarSkipped, skipCalendar] = useSkip(CALENDAR_SKIPPED_KEY)
  const [notesSkipped, skipNotes] = useSkip(NOTES_SKIPPED_KEY)
  const usage = useUsageSharing()
  const steps = setupSteps(view.permissionStatus, view.runtime, view.calendar, { notes: notesSkipped, calendar: calendarSkipped }, usage.status?.sharing ?? null)
  const notes = useNotesChoice(steps.notes === 'todo' || steps.notes === 'error')
  const visible = setupVisible(steps)
  const [opened, setOpened] = useState(false)
  const [closed, setClosed] = useState(() => window.localStorage.getItem(FINISHED_SHOWN_KEY) === 'true')
  if (visible && !opened) setOpened(true)
  if (!visible) return opened && !closed ? <SetupFinished view={view} agent={notes.saved} onClose={() => setClosed(true)} /> : null
  const current = (Object.keys(steps) as Array<keyof typeof steps>).find((key) => steps[key] !== null && !isFinished(steps[key]))
  const primary = (key: keyof typeof steps) => key === current ? 'primary' : 'secondary'
  const rows: Step[] = []
  if (steps.recording) rows.push(recordingRow(steps.recording, view, primary('recording')))
  if (steps.speech) rows.push(speechRow(steps.speech, view, primary('speech')))
  if (steps.notes) rows.push(notesRow(steps.notes, view, notes, skipNotes))
  if (steps.calendar) rows.push(calendarRow(steps.calendar, view, skipCalendar))
  if (steps.usage) rows.push(usageRow(steps.usage, usage))
  const finished = rows.filter((row) => isFinished(row.state)).length
  return (
    <section className="setup-checklist ui-scroll" aria-labelledby="setup-checklist-title">
      <header className="setup-checklist-head">
        <h2 id="setup-checklist-title">Set up Gappd</h2>
        <span>{finished} of {rows.length} done</span>
      </header>
      <ol>{rows.map((row, index) => <StepRow key={row.key} step={row} number={index + 1} current={row.key === current} />)}</ol>
    </section>
  )
}

/** Shown once ever, after the last step finishes, so a skip is never silent. */
function SetupFinished({ view, agent, onClose }: { view: AppView; agent: AIProviderStatus | null; onClose: () => void }) {
  useEffect(() => { window.localStorage.setItem(FINISHED_SHOWN_KEY, 'true') }, [])
  const notesOff = notesAvailability(view.runtime) === 'off'
  const agentName = agent && isAgentId(agent.provider) ? agentInfo(agent.provider).name : null
  const notes = notesOff
    ? ' Notes are off, so you get transcripts only. You can turn on notes in Settings › Meeting processing.'
    : agentName ? ` ${agentName} writes the notes${agent?.agentModel ? ` with ${agent.agentModel}` : ''}.` : ''
  return (
    <section className="setup-checklist setup-finished" aria-labelledby="setup-finished-title">
      <div className="setup-step-body">
        <h2 id="setup-finished-title">Gappd is ready</h2>
        <p>Click Record when a meeting starts.{notes}</p>
      </div>
      <div className="setup-step-actions">
        {notesOff || agentName ? <Button onClick={() => view.actions.openSettings('Meeting processing')}>{notesOff ? 'Turn on notes' : 'Change notes model'}</Button> : null}
        <Button onClick={onClose}>Done</Button>
      </div>
      <SetupTestRecording view={view} />
    </section>
  )
}

function StepRow({ step, number, current }: { step: Step; number: number; current: boolean }) {
  const finished = isFinished(step.state)
  return (
    <li className={cx('setup-step', step.state, current && 'current')} aria-current={current ? 'step' : undefined}>
      <span className="setup-step-marker" aria-hidden="true">{finished ? <Check /> : number}</span>
      <div className="setup-step-body">
        <strong>{step.title}{step.optional ? <span className="setup-step-tag">Optional</span> : null}</strong>
        <div className="setup-step-detail">{step.detail}</div>
      </div>
      {step.actions ? <div className="setup-step-actions">{step.actions}</div> : null}
    </li>
  )
}

function recordingRow(state: SetupStepState, view: AppView, variant: ButtonVariant): Step {
  const base = { key: 'recording', title: 'Allow recording', state }
  if (state === 'done') return { ...base, detail: <p>Microphone and meeting audio are allowed.</p> }
  const privacy = <>
    <p>Gappd records your microphone and meeting audio. By default, audio, transcripts, and notes stay on this Mac. No account needed.</p>
    <p className="setup-step-note">macOS lists meeting audio under Screen &amp; System Audio Recording. Gappd captures your screen only when you turn on Screen video.</p>
  </>
  // macOS applies a new Screen & System Audio Recording grant only after the app restarts.
  if (state === 'blocked') return { ...base, detail: <>{privacy}<p className="setup-step-warning">Access is off. In System Settings, turn on Gappd under Microphone and under Screen &amp; System Audio Recording. After you allow it, reopen Gappd.</p></>, actions: <>
    <Button variant={variant} onClick={view.actions.requestPermissions}>Open System Settings</Button>
    <Button onClick={view.actions.relaunch}>Reopen Gappd</Button>
  </> }
  if (state === 'error') return { ...base, detail: <>{privacy}<p className="setup-step-warning">Gappd could not check recording access. Try again.</p></>, actions: <Button variant={variant} onClick={view.actions.requestPermissions}>Try again</Button> }
  return { ...base, detail: privacy, actions: <Button variant={variant} disabled={state === 'working'} onClick={view.actions.requestPermissions}>{state === 'working' ? 'Waiting for macOS…' : 'Allow recording access'}</Button> }
}

function speechRow(state: SetupStepState, view: AppView, variant: ButtonVariant): Step {
  const base = { key: 'speech', title: 'Transcripts on this Mac', state }
  if (state === 'done') return { ...base, detail: <p>Apple's speech model is ready. Transcripts never leave this Mac.</p> }
  if (state === 'error') return { ...base, detail: <p className="setup-step-warning">Apple's speech model did not download, so Gappd cannot make transcripts yet. {view.runtime?.capabilities.transcription.message}</p>, actions: <Button variant={variant} disabled={view.runtimeBusy} onClick={view.actions.prepareSpeech}>Try again</Button> }
  return { ...base, detail: <p className="setup-step-note">Downloading Apple's speech model. This happens once and needs no action.</p> }
}

type NotesChoice = { installs: AgentInstall[] | null; finding: boolean; busy: AgentId | null; error: string | null; saved: AIProviderStatus | null; useAgent(install: AgentInstall): void; recheck(): void }

function notesRow(state: SetupStepState, view: AppView, choice: NotesChoice, skip: () => void): Step {
  const base = { key: 'notes', title: 'Meeting notes with AI', optional: true, state }
  const runtime = view.runtime
  if (state === 'done') return { ...base, detail: <p>On. Gappd writes notes after each meeting. Change this in Settings.</p> }
  if (state === 'skipped') return { ...base, detail: <p>Skipped. Gappd makes transcripts only. Turn on notes in Settings.</p> }
  if (state === 'working') return { ...base, detail: <LocalAiProgress message={runtime?.message} progress={runtime?.progress} /> }
  const failure = state === 'error' ? runtimeErrorView(runtime) : null
  const busy = view.runtimeBusy || choice.busy !== null
  // Options that work now come first; agents that need a sign-in follow.
  const found = (choice.installs ?? []).filter((install) => install.executable).sort((a, b) => Number(b.signedIn) - Number(a.signedIn))
  return {
    ...base,
    detail: <>
      <p>Gappd can turn each transcript into notes: a summary, decisions, and action items. Choose where this happens, or skip it. You can change it later in Settings.</p>
      {failure ? <p className="setup-step-warning">{failure.title} {failure.detail}</p> : null}
      {choice.error ? <p className="setup-step-warning">{choice.error}</p> : null}
      <div className="setup-choices">
        <NotesOption title="On this Mac" points={['Private. Transcripts and notes stay on this Mac.', `One-time ${MODEL_SIZE} download. Works offline.`]}>
          <Button disabled={busy} onClick={state === 'error' ? view.actions.repairRuntime : view.actions.setupRuntime}>{state === 'error' ? 'Try again' : `Download ${MODEL_SIZE}`}</Button>
        </NotesOption>
        {found.map((install) => {
          const info = agentInfo(install.agent)
          return <NotesOption key={install.agent} title={info.name} points={install.signedIn ? [info.account, info.sendsTo] : [`Found ${info.name}, but it is not signed in.`, `${info.signIn}, then come back.`]}>
            {install.signedIn
              ? <Button disabled={busy} onClick={() => choice.useAgent(install)}>{choice.busy === install.agent ? `Checking ${info.name}…` : `Use ${info.name}`}</Button>
              : <Button aria-label={`Check ${info.name} sign-in again`} disabled={choice.finding} onClick={choice.recheck}>{choice.finding ? 'Checking…' : 'Check again'}</Button>}
          </NotesOption>
        })}
      </div>
      <p className="setup-step-note"><button type="button" className="app-link" disabled={busy} onClick={skip}>Not now</button> · Get transcripts only. You can turn on notes later in Settings.</p>
      {choice.installs && !found.length ? <p className="setup-step-note">Have {new Intl.ListFormat('en', { type: 'disjunction' }).format(AGENTS.map((agent) => agent.name))}? Install one and Gappd finds it here.</p> : null}
    </>,
  }
}

function NotesOption({ title, points, children }: { title: string; points: string[]; children: ReactNode }) {
  return <div className="setup-choice">
    <strong>{title}</strong>
    <ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
    {children}
  </div>
}

/** Finds the installed agents while the choice is open and saves one with one click. */
function useNotesChoice(open: boolean): NotesChoice {
  const found = useAgentInstalls(open)
  const [busy, setBusy] = useState<AgentId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<AIProviderStatus | null>(null)
  const useAgent = (install: AgentInstall) => {
    if (!install.executable) return
    setBusy(install.agent); setError(null)
    window.gappd.aiProvider.configureAgent({ agent: install.agent, executable: install.executable, model: '', reasoningEffort: '' })
      .then(setSaved)
      .catch((cause) => setError(`Gappd could not use ${agentInfo(install.agent).name}. ${ipcErrorMessage(cause)}`))
      .finally(() => setBusy(null))
  }
  return { installs: found.installs, finding: found.checking, busy, error, saved, useAgent, recheck: found.recheck }
}

function ipcErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
}

function LocalAiProgress({ message, progress }: { message?: string; progress?: number }) {
  const value = typeof progress === 'number' ? Math.round(progress) : null
  return <div className="setup-step-progress">
    <p>{message || 'Preparing Local AI'}{value === null ? '' : ` · ${value}%`}</p>
    <ProgressBar value={value} label="Local AI setup progress" />
    <p className="setup-step-note">You can keep using Gappd while this runs.</p>
  </div>
}

function calendarRow(state: SetupStepState, view: AppView, skip: () => void): Step {
  const base = { key: 'calendar', title: 'Connect Google Calendar', optional: true, state }
  if (state === 'done') return { ...base, detail: <p>Connected as {view.calendar?.connections[0]?.email}.</p> }
  if (state === 'skipped') return { ...base, detail: <p>Skipped. You can connect later in Settings.</p> }
  const connecting = view.calendarBusy === 'connect'
  return {
    ...base,
    detail: <p>See today's meetings here and match recordings to events. Gappd only reads your calendar.</p>,
    actions: <>
      <Button disabled={Boolean(view.calendarBusy)} onClick={() => void view.actions.connectCalendar()}>{connecting ? 'Connecting…' : 'Connect'}</Button>
      <Button disabled={connecting} onClick={skip}>Skip</Button>
    </>,
  }
}

function usageRow(state: SetupStepState, usage: ReturnType<typeof useUsageSharing>): Step {
  const base = { key: 'usage', title: 'Share anonymous usage counts', optional: true, state }
  if (state === 'done') return { ...base, detail: <p>Thank you. You can see each report or stop sharing in Settings › General.</p> }
  if (state === 'skipped') return { ...base, detail: <p>Not shared. You can turn it on in Settings › General.</p> }
  return {
    ...base,
    detail: <>
      <p>Once a day, Gappd can send counts that help us improve it: how many Meetings you recorded in a range such as 2–5, total minutes, and which features are on.</p>
      <p className="setup-step-note">No account or ID, and no names, titles, transcripts, or notes.</p>
      {usage.error ? <p className="setup-step-warning">{usage.error}</p> : null}
    </>,
    actions: <>
      <Button onClick={() => void usage.setSharing(true)}>Share</Button>
      <Button onClick={() => void usage.setSharing(false)}>Don't share</Button>
    </>,
  }
}

function isFinished(state: SetupStepState | null): boolean {
  return state === 'done' || state === 'skipped'
}

function useSkip(key: string): [boolean, () => void] {
  const [skipped, setSkipped] = useState(() => window.localStorage.getItem(key) === 'true')
  return [skipped, () => { window.localStorage.setItem(key, 'true'); setSkipped(true) }]
}
