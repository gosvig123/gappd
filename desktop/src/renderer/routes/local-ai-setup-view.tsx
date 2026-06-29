import '../components/local-ai.css'
import {
  localAISetupErrorView,
  localAISetupMessageView,
  localAISetupPhaseLabel,
  localAISetupStatusTone,
  type LocalAISetupStatus,
} from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'
import { Button, Card, Field, PageHeader, Panel, ProgressBar, StatusPill, cx } from '../components/ui'
import { isManagedOllamaModel, type ManagedOllamaModelOption, type ManagedOllamaModelTag } from '../../shared/bundled-ollama'
import type { SetupPermissionState } from '../hooks/use-setup-permissions'

type LocalAISetupViewProps = {
  status: LocalAISetupStatus
  busy: boolean
  selectedModel: ManagedOllamaModelTag
  modelOptions: readonly ManagedOllamaModelOption[]
  permissionState: SetupPermissionState
  onModelChange: (model: ManagedOllamaModelTag) => void
  onStart: () => void
  onRetry: () => void
  onRequestPermissions: () => void
}

type PhaseCopy = { headline: string; detail: string; progress: string; action: string; hint?: string }
type SetupStepState = 'done' | 'active' | 'locked' | 'blocked'
type SetupStep = { label: string; detail: string; state: SetupStepState }
type ActionModel = { label: string; disabled: boolean; hint?: string; onAction: () => void }

const SHOW_PERMISSION_DEBUG = import.meta.env.DEV
const ACTIVE_INSTALL_PHASES: LocalAISetupStatus['phase'][] = ['starting_ollama', 'pulling_model', 'saving_config']

const PHASE_COPY: Record<LocalAISetupStatus['phase'], PhaseCopy> = {
  checking: { headline: 'Checking this Mac.', detail: 'Gappd is looking for existing local tools.', progress: 'Checking what is already ready.', action: 'Checking setup...' },
  needs_setup: { headline: 'Set up private meeting notes.', detail: 'Install local AI once. Recordings and notes stay on this Mac.', progress: 'Downloads run only after you start setup.', action: 'Install local AI' },
  starting_ollama: { headline: 'Starting local AI.', detail: 'Gappd is starting private tools for meeting notes.', progress: 'This usually finishes quickly.', action: 'Installing...' },
  pulling_model: { headline: 'Downloading local AI.', detail: 'First setup can take several minutes.', progress: 'Keep Gappd open while downloads finish.', action: 'Installing...', hint: 'Downloads can pause between updates.' },
  saving_config: { headline: 'Finishing setup.', detail: 'Downloads are done. Gappd is saving setup for future meetings.', progress: 'Almost done.', action: 'Installing...' },
  ready: { headline: 'Local AI is ready.', detail: 'Next, allow microphone and screen/system audio access.', progress: 'Setup complete.', action: 'Allow recording access' },
  error: { headline: 'Setup needs attention.', detail: 'Gappd stopped before setup finished.', progress: 'Setup paused because something needs attention.', action: 'Fix setup' },
}

export function LocalAISetupView(props: LocalAISetupViewProps) {
  return (
    <Panel className="panel-large setup-shell">
      <PageHeader title="Set up Gappd" description="Two steps: install local AI, then allow recording access." action={<StatusPill tone={localAISetupStatusTone(props.status.phase)}>{localAISetupPhaseLabel(props.status.phase)}</StatusPill>} />
      <SetupBody {...props} copy={PHASE_COPY[props.status.phase]} />
    </Panel>
  )
}

function SetupBody(props: LocalAISetupViewProps & { copy: PhaseCopy }) {
  const action = setupAction(props)
  const errorView = localAISetupErrorView(props.status)
  return (
    <div className="setup-primary">
      <div className="setup-main">
        <SetupHero copy={props.copy} />
        <SetupActions busy={props.busy} action={action} />
        {showProgress(props.status, props.busy) ? <SetupProgressCard status={props.status} copy={props.copy} /> : null}
        <PermissionSetupCard status={props.status} state={props.permissionState} />
        {errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}
        <SetupAdvancedDetails {...props} />
      </div>
      <SetupPlan status={props.status} permission={props.permissionState} />
    </div>
  )
}

function SetupHero({ copy }: { copy: PhaseCopy }) {
  return <Card className="setup-callout accent"><strong>Private by default</strong><h2>{copy.headline}</h2><p>{copy.detail}</p><ul className="setup-benefits"><li>Downloads happen once.</li><li>No cloud account or API key.</li><li>Meeting audio stays local.</li></ul></Card>
}

function SetupPlan({ status, permission }: { status: LocalAISetupStatus; permission: SetupPermissionState }) {
  return <Card className="setup-steps"><div><div className="label">Setup path</div><h3>Two steps</h3></div>{setupSteps(status, permission).map((step) => <SetupStepRow key={step.label} step={step} />)}</Card>
}

function SetupStepRow({ step }: { step: SetupStep }) {
  return <div className={cx('setup-step', step.state)}><span>{stepIcon(step.state)}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div></div>
}

function SetupProgressCard({ status, copy }: { status: LocalAISetupStatus; copy: PhaseCopy }) {
  const progress = status.phase === 'ready' ? 100 : typeof status.progress === 'number' ? progressValue(status.progress) : null
  return <Card className="progress-block"><ProgressHeader status={status} progress={progress} /><ProgressBar value={progress} label="Local AI setup progress" /><p className="progress-copy">{copy.progress}</p><CurrentStep status={status} /></Card>
}

function ProgressHeader({ status, progress }: { status: LocalAISetupStatus; progress: number | null }) {
  return <div className="progress-head"><span className="label">Installing local AI</span><span className="progress-copy">{progress === null ? progressLabel(status) : `${progress}%`}</span></div>
}

function CurrentStep({ status }: { status: LocalAISetupStatus }) {
  const message = localAISetupMessageView(status)
  if (!message) return null
  return <div className="setup-progress-detail"><div className="label">Current step</div><div className="setup-progress-headline">{message.headline}</div>{message.detail ? <p className="progress-copy">{message.detail}</p> : null}</div>
}

function PermissionSetupCard({ status, state }: { status: LocalAISetupStatus; state: SetupPermissionState }) {
  if (status.phase !== 'ready') return null
  return <Card className="setup-permissions"><div><div className="label">Recording access</div><h3>{permissionTitle(state)}</h3></div><p>{permissionDetail(state)}</p><PermissionDebug state={state} /></Card>
}

function SetupActions({ busy, action }: { busy: boolean; action: ActionModel }) {
  return <div className="setup-actions"><div className="actions-row"><Button variant="primary" onClick={action.onAction} disabled={busy || action.disabled}>{busy ? 'Setting up...' : action.label}</Button></div>{action.hint ? <p className="action-copy">{action.hint}</p> : null}</div>
}

function SetupAdvancedDetails(props: Pick<LocalAISetupViewProps, 'status' | 'busy' | 'selectedModel' | 'modelOptions' | 'onModelChange'>) {
  const selected = props.modelOptions.find((option) => option.tag === props.selectedModel)
  return <details className="setup-advanced"><summary>Advanced</summary><Field label="Model quality" className="setup-model-picker" hint={selected?.detail}><select value={props.selectedModel} onChange={(event) => updateSelectedModel(event.currentTarget.value, props.onModelChange)} disabled={modelSelectDisabled(props)}>{props.modelOptions.map((option) => <option key={option.tag} value={option.tag}>{option.label}</option>)}</select></Field></details>
}

function PermissionDebug({ state }: { state: SetupPermissionState }) {
  const details = state.permissions?.details
  if (!SHOW_PERMISSION_DEBUG || !details) return null
  return <details className="permission-debug"><summary>Permission debug</summary>{Object.entries(details).map(([key, value]) => <div key={key}><strong>{key}</strong><span>{value || 'empty'}</span></div>)}</details>
}

function setupAction(props: LocalAISetupViewProps & { copy: PhaseCopy }): ActionModel {
  if (props.status.phase === 'ready') return permissionAction(props)
  const retry = props.status.phase === 'error' || props.status.canRetry
  return { label: retry ? 'Fix setup' : props.copy.action, disabled: props.status.phase === 'checking' && !props.busy, hint: installHint(props), onAction: retry ? props.onRetry : props.onStart }
}

function permissionAction(props: LocalAISetupViewProps): ActionModel {
  const status = props.permissionState.status
  const label = status === 'checking' ? 'Checking permissions...' : status === 'granted' ? 'Start using Gappd' : status === 'blocked' || status === 'unknown' || status === 'error' ? 'Open System Settings' : 'Allow recording access'
  return { label, disabled: status === 'checking', onAction: props.onRequestPermissions }
}

function setupSteps(status: LocalAISetupStatus, permission: SetupPermissionState): SetupStep[] {
  const aiReady = status.phase === 'ready'
  return [{ label: 'Install local AI', detail: localAIDetail(status), state: localAIState(status) }, permissionStep(aiReady, permission)]
}

function permissionStep(aiReady: boolean, permission: SetupPermissionState): SetupStep {
  if (!aiReady) return { label: 'Allow recording access', detail: 'Comes after local AI install', state: 'locked' }
  if (permission.status === 'granted') return { label: 'Allow recording access', detail: 'Done', state: 'done' }
  if (permission.status === 'blocked' || permission.status === 'error') return { label: 'Allow recording access', detail: 'Needs System Settings', state: 'blocked' }
  return { label: 'Allow recording access', detail: 'Microphone and screen/system audio', state: 'active' }
}

function localAIState(status: LocalAISetupStatus): SetupStepState {
  if (status.phase === 'ready') return 'done'
  if (status.phase === 'error') return 'blocked'
  return 'active'
}

function localAIDetail(status: LocalAISetupStatus): string {
  if (status.phase === 'ready') return 'Done'
  if (showProgress(status, false)) return 'Installing transcript and summary tools'
  if (status.phase === 'error') return 'Needs attention'
  return 'Transcript and summary tools'
}

function installHint(props: LocalAISetupViewProps & { copy: PhaseCopy }): string | undefined {
  if (props.status.phase === 'needs_setup') return 'Setup starts only when you click. Downloads can be several GB.'
  return showProgress(props.status, props.busy) ? props.copy.hint : undefined
}

function permissionTitle(state: SetupPermissionState): string {
  if (state.status === 'granted') return 'Access ready.'
  if (state.status === 'checking') return 'Checking access.'
  if (state.status === 'blocked') return 'Permission blocked.'
  if (state.status === 'unknown' || state.status === 'error') return 'Could not confirm access.'
  return 'Allow microphone and screen/system audio.'
}

function permissionDetail(state: SetupPermissionState): string {
  if (state.status === 'blocked') return 'Enable GappdCapture for Screen & System Audio Recording and Microphone, then return to Gappd.'
  if (state.status === 'unknown') return 'macOS did not give a clear answer. Open System Settings and enable access manually.'
  if (state.status === 'error') return state.error || 'Permission check failed. Open System Settings if access needs manual approval.'
  return 'Gappd asks now so recording does not stop during your first meeting.'
}

function showProgress(status: LocalAISetupStatus, busy: boolean): boolean {
  return busy || ACTIVE_INSTALL_PHASES.includes(status.phase)
}

function progressLabel(status: LocalAISetupStatus): string {
  return status.phase === 'error' ? 'Stopped' : 'Working'
}

function progressValue(progress: number): number {
  return Math.max(0, Math.min(100, progress))
}

function stepIcon(state: SetupStepState): string {
  if (state === 'done') return '✓'
  if (state === 'blocked') return '!'
  if (state === 'active') return '•'
  return '○'
}

function modelSelectDisabled(props: Pick<LocalAISetupViewProps, 'status' | 'busy'>): boolean {
  return props.busy || (props.status.phase !== 'needs_setup' && props.status.phase !== 'error')
}

function updateSelectedModel(value: string, onModelChange: (model: ManagedOllamaModelTag) => void): void {
  if (isManagedOllamaModel(value)) onModelChange(value)
}
