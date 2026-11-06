import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { FINISHED_SHOWN_KEY, type useAccountRequirement } from '../hooks/use-account-requirement'
import type { useCloudAccount } from '../hooks/use-cloud-account'
import type { AppView } from '../lib/app-view'
import { SetupTestRecording } from './setup-test-recording'
import { notesAvailability, setupSteps, setupVisible, type SetupStepState } from '../lib/setup-steps'
import { Button, cx } from './ui'
import './setup-checklist.css'

type ButtonVariant = 'primary' | 'secondary'
type Step = { key: string; title: string; state: SetupStepState; detail: ReactNode; actions?: ReactNode }

export type SetupState = ReturnType<typeof useSetupState>

/**
 * First-run setup, shared by the checklist and the Feature prompts. open is true
 * while setup may still show anything (status still loading, a step open, or the
 * "Gappd is ready" card), so a Feature prompt never stacks on it.
 */
export function useSetupState(view: AppView, account: ReturnType<typeof useAccountRequirement>) {
  const { cloud, asks, signedIn } = account
  const steps = setupSteps(view.permissionStatus, view.runtime, { account: cloud.account, asks, signedIn })
  const visible = setupVisible(steps)
  const [opened, setOpened] = useState(false)
  const [closed, setClosed] = useState(() => window.localStorage.getItem(FINISHED_SHOWN_KEY) === 'true')
  if (visible && !opened) setOpened(true)
  // Until Gappd knows whether to ask for an account, it shows nothing, so "Gappd is ready" never comes early.
  const hidden = asks === null || (asks === true && !signedIn && !cloud.account)
  const finished = !visible && opened && !closed
  const loading = view.permissionStatus === 'waiting' || view.runtime === null
  return { steps, visible, finished, hidden, open: hidden || loading || visible || finished, closeFinished: () => setClosed(true) }
}

/**
 * First-run setup: only what Record needs, one step at a time. It explains what
 * Gappd records before macOS asks, and it leaves once those steps are done.
 * Other features are asked later, when they first help (feature-prompt.tsx).
 */
export function SetupChecklist({ view, account, setup }: { view: AppView; account: ReturnType<typeof useAccountRequirement>; setup: SetupState }) {
  const { cloud } = account
  const { steps } = setup
  if (setup.hidden) return null
  if (!setup.visible) return setup.finished ? <SetupFinished view={view} onClose={setup.closeFinished} /> : null
  const current = (Object.keys(steps) as Array<keyof typeof steps>).find((key) => steps[key] !== null && !isFinished(steps[key]))
  const primary = (key: keyof typeof steps) => key === current ? 'primary' : 'secondary'
  const rows: Step[] = []
  if (steps.account) rows.push(accountRow(steps.account, cloud, primary('account')))
  if (steps.recording) rows.push(recordingRow(steps.recording, view, primary('recording'), steps.speech === 'working'))
  // The speech model downloads by itself, so it gets a row only when it needs action.
  if (steps.speech === 'error') rows.push(speechRow(view, primary('speech')))
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

/** Shown once ever, after the last step finishes, with a test recording to prove that capture works. */
function SetupFinished({ view, onClose }: { view: AppView; onClose: () => void }) {
  useEffect(() => { window.localStorage.setItem(FINISHED_SHOWN_KEY, 'true') }, [])
  const notesLater = notesAvailability(view.runtime) === 'off' ? ' After your first Meeting, Gappd asks if you want notes with AI.' : ''
  return (
    <section className="setup-checklist setup-finished" aria-labelledby="setup-finished-title">
      <div className="setup-step-body">
        <h2 id="setup-finished-title">Gappd is ready</h2>
        <p>Click Record when a meeting starts.{notesLater}</p>
      </div>
      <div className="setup-step-actions">
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
        <strong>{step.title}</strong>
        <div className="setup-step-detail">{step.detail}</div>
      </div>
      {step.actions ? <div className="setup-step-actions">{step.actions}</div> : null}
    </li>
  )
}

type CloudAccount = ReturnType<typeof useCloudAccount>

/**
 * The account step shows after the sign-up screen: signed in, or still to do after the person
 * continued without an account. It has no skip. Sync stays off until Settings.
 */
function accountRow(state: SetupStepState, cloud: CloudAccount, variant: ButtonVariant): Step {
  const base = { key: 'account', title: 'Create your free Gappd account', state }
  if (state === 'done') return { ...base, detail: <p>Signed in as {cloud.account?.email}. Meeting sync stays off until you turn it on in Settings › Connections.</p> }
  if (state === 'working') return { ...base, detail: <p className="setup-step-note">Finish signing in in your browser, then come back to Gappd.</p>, actions: <Button onClick={() => void cloud.cancel()}>Cancel</Button> }
  return {
    ...base,
    detail: <>
      <p>Use your Google account or any email address. Your browser opens; it takes about a minute.</p>
      <p className="setup-step-note">Signing in uploads nothing. Meeting sync stays off until you turn it on in Settings.</p>
      {cloud.error ? <p className="setup-step-warning">{cloud.error}</p> : null}
    </>,
    actions: <Button variant={variant} disabled={cloud.connecting} onClick={() => void cloud.signIn()}>Sign up or sign in</Button>,
  }
}

function recordingRow(state: SetupStepState, view: AppView, variant: ButtonVariant, speechDownloading: boolean): Step {
  const base = { key: 'recording', title: 'Allow recording', state }
  const speech = speechDownloading ? <p className="setup-step-note">Gappd is downloading Apple's speech model for transcripts. This happens once and needs no action.</p> : null
  if (state === 'done') return { ...base, detail: <><p>Microphone and meeting audio are allowed.</p>{speech}</> }
  const privacy = <>
    <p>Gappd records your microphone and meeting audio. By default, audio, transcripts, and notes stay on this Mac.</p>
    <p className="setup-step-note">macOS lists meeting audio under Screen &amp; System Audio Recording. Gappd captures your screen only when you turn on Screen video.</p>
    {speech}
  </>
  // macOS applies a new Screen & System Audio Recording grant only after the app restarts.
  if (state === 'blocked') return { ...base, detail: <>{privacy}<p className="setup-step-warning">Access is off. In System Settings, turn on Gappd under Microphone and under Screen &amp; System Audio Recording. After you allow it, reopen Gappd.</p></>, actions: <>
    <Button variant={variant} onClick={view.actions.requestPermissions}>Open System Settings</Button>
    <Button onClick={view.actions.relaunch}>Reopen Gappd</Button>
  </> }
  if (state === 'error') return { ...base, detail: <>{privacy}<p className="setup-step-warning">Gappd could not check recording access. Try again.</p></>, actions: <Button variant={variant} onClick={view.actions.requestPermissions}>Try again</Button> }
  return { ...base, detail: privacy, actions: <Button variant={variant} disabled={state === 'working'} onClick={view.actions.requestPermissions}>{state === 'working' ? 'Waiting for macOS…' : 'Allow recording access'}</Button> }
}

function speechRow(view: AppView, variant: ButtonVariant): Step {
  return {
    key: 'speech', title: 'Transcripts on this Mac', state: 'error',
    detail: <p className="setup-step-warning">Apple's speech model did not download, so Gappd cannot make transcripts yet. {view.runtime?.capabilities.transcription.message}</p>,
    actions: <Button variant={variant} disabled={view.runtimeBusy} onClick={view.actions.prepareSpeech}>Try again</Button>,
  }
}

function isFinished(state: SetupStepState | null): boolean {
  return state === 'done'
}
