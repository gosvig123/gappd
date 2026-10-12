import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT } from '../../shared/managed-local-ai'
import type { AppView } from '../lib/app-view'
import { setupSteps, setupVisible, type SetupStepState } from '../lib/setup-steps'
import { runtimeErrorView } from './settings/managed-runtime-contract'
import { Button, ProgressBar, cx } from './ui'
import './setup-checklist.css'

const CALENDAR_SKIPPED_KEY = 'gappd.setup.calendarSkipped'
const MODEL_SIZE = `${(MANAGED_LLAMACPP_MODEL_ARTIFACT.size / 1e9).toFixed(1)} GB`

type ButtonVariant = 'primary' | 'secondary'
type Step = { key: string; title: string; optional?: boolean; state: SetupStepState; detail: ReactNode; actions?: ReactNode }

/**
 * First-run setup, one step at a time. It explains what Gappd records before
 * macOS asks, and it leaves once every step that applies is done or skipped.
 */
export function SetupChecklist({ view }: { view: AppView }) {
  const [calendarSkipped, skipCalendar] = useCalendarSkip()
  const steps = setupSteps(view.permissionStatus, view.runtime, view.calendar, calendarSkipped)
  if (!setupVisible(steps)) return null
  const current = (Object.keys(steps) as Array<keyof typeof steps>).find((key) => steps[key] !== null && !isFinished(steps[key]))
  const primary = (key: keyof typeof steps) => key === current ? 'primary' : 'secondary'
  const rows: Step[] = []
  if (steps.recording) rows.push(recordingRow(steps.recording, view, primary('recording')))
  if (steps.localAi) rows.push(localAiRow(steps.localAi, view, primary('localAi')))
  if (steps.calendar) rows.push(calendarRow(steps.calendar, view, skipCalendar))
  const finished = rows.filter((row) => isFinished(row.state)).length
  return (
    <section className="setup-checklist" aria-labelledby="setup-checklist-title">
      <header className="setup-checklist-head">
        <h2 id="setup-checklist-title">Set up Gappd</h2>
        <span>{finished} of {rows.length} done</span>
      </header>
      <ol>{rows.map((row, index) => <StepRow key={row.key} step={row} number={index + 1} current={row.key === current} />)}</ol>
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
  if (state === 'blocked') return { ...base, detail: <>{privacy}<p className="setup-step-warning">Access is off. In System Settings, turn on Gappd under Microphone and under Screen &amp; System Audio Recording, then come back here.</p></>, actions: <Button variant={variant} onClick={view.actions.requestPermissions}>Open System Settings</Button> }
  if (state === 'error') return { ...base, detail: <>{privacy}<p className="setup-step-warning">Gappd could not check recording access. Try again.</p></>, actions: <Button variant={variant} onClick={view.actions.requestPermissions}>Try again</Button> }
  return { ...base, detail: privacy, actions: <Button variant={variant} disabled={state === 'working'} onClick={view.actions.requestPermissions}>{state === 'working' ? 'Waiting for macOS…' : 'Allow recording access'}</Button> }
}

function localAiRow(state: SetupStepState, view: AppView, variant: ButtonVariant): Step {
  const base = { key: 'localAi', title: 'Prepare Local AI', state }
  const runtime = view.runtime
  if (state === 'done') return { ...base, detail: <p>Ready. Gappd writes your notes on this Mac.</p> }
  if (state === 'working') return { ...base, detail: <LocalAiProgress message={runtime?.message} progress={runtime?.progress} /> }
  if (state === 'error') {
    const error = runtimeErrorView(runtime)
    return { ...base, detail: <p className="setup-step-warning">{error?.title ?? 'Local AI setup stopped.'} {error?.detail ?? runtime?.message}</p>, actions: <Button variant={variant} disabled={view.runtimeBusy} onClick={view.actions.repairRuntime}>{view.runtimeBusy ? 'Repairing…' : 'Repair local AI'}</Button> }
  }
  return { ...base, detail: <p>Gappd downloads a {MODEL_SIZE} notes model and the Apple speech model once. After that, transcripts and notes are made on this Mac.</p>, actions: <Button variant={variant} disabled={view.runtimeBusy} onClick={view.actions.setupRuntime}>{view.runtimeBusy ? 'Preparing…' : 'Set up local AI'}</Button> }
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

function isFinished(state: SetupStepState | null): boolean {
  return state === 'done' || state === 'skipped'
}

function useCalendarSkip(): [boolean, () => void] {
  const [skipped, setSkipped] = useState(() => window.localStorage.getItem(CALENDAR_SKIPPED_KEY) === 'true')
  return [skipped, () => { window.localStorage.setItem(CALENDAR_SKIPPED_KEY, 'true'); setSkipped(true) }]
}
