import '../components/local-ai.css'

import {
  onboardingErrorView,
  onboardingMessageView,
  onboardingPhaseLabel,
  onboardingStatusTone,
  type OnboardingStatus,
} from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'
import { Button, Card, Field, MetricCard, PageHeader, Panel, ProgressBar, StatusPill, cx } from '../components/ui'
import { isManagedOllamaModel, type ManagedOllamaModelOption, type ManagedOllamaModelTag } from '../../shared/bundled-ollama'
import type { CapturePermissionTarget } from '../../shared/ipc-contract'
import type { SetupPermissionState } from '../hooks/use-setup-permissions'

type OnboardingViewProps = {
  status: OnboardingStatus
  busy: boolean
  selectedModel: ManagedOllamaModelTag
  modelOptions: readonly ManagedOllamaModelOption[]
  permissionState: SetupPermissionState
  onModelChange: (model: ManagedOllamaModelTag) => void
  onStart: () => void
  onRetry: () => void
  onRequestPermissions: () => void
  onOpenPermissionsSettings: (target?: CapturePermissionTarget) => void
}

type SetupActionsProps = {
  busy: boolean
  disabled: boolean
  label: string
  hint?: string
  onAction: () => void
}

type SetupProgressCardProps = {
  status: OnboardingStatus
  copy: OnboardingPhaseCopy
}

type OnboardingPhaseCopy = {
  headline: string
  detail: string
  progressDetail: string
  actionLabel: string
  actionHint?: string
}

type SetupStepState = 'done' | 'active' | 'locked' | 'blocked'
type SetupStep = { label: string; detail: string; state: SetupStepState }

const PHASE_COPY: Record<OnboardingStatus['phase'], OnboardingPhaseCopy> = {
  checking: { headline: 'Checking setup.', detail: 'Looking for tools already installed on this Mac.', progressDetail: 'Gappd is checking what is already ready.', actionLabel: 'Checking setup...' },
  needs_setup: { headline: 'Gappd needs one-time setup.', detail: 'Download local AI tools once. Recordings stay on this Mac.', progressDetail: 'Setup downloads speech and summary tools, then saves them for next time.', actionLabel: 'Set up Gappd' },
  starting_ollama: { headline: 'Starting local AI tools.', detail: 'Gappd is starting private tools used for meeting notes.', progressDetail: 'This step usually finishes quickly.', actionLabel: 'Setting up...' },
  pulling_model: { headline: 'Downloading local AI tools.', detail: 'First setup can take several minutes depending on connection speed.', progressDetail: 'Keep Gappd open while downloads finish.', actionLabel: 'Setting up...', actionHint: 'Downloads can pause between updates. Gappd keeps working until setup finishes or shows a fix.' },
  saving_config: { headline: 'Finishing setup.', detail: 'Downloads are done. Gappd is saving setup for future meetings.', progressDetail: 'Almost done.', actionLabel: 'Setting up...' },
  ready: { headline: 'Gappd is ready.', detail: 'You can record meetings and keep notes local on this Mac.', progressDetail: 'Setup complete.', actionLabel: 'Start recording' },
  error: { headline: 'Setup needs attention.', detail: 'Gappd stopped before setup finished. Try the fix below.', progressDetail: 'Setup paused because something needs attention.', actionLabel: 'Fix setup' },
}

function hasNumericProgress(status: OnboardingStatus): status is OnboardingStatus & { progress: number } {
  return typeof status.progress === 'number'
}

function progressValue(progress: number): number {
  return Math.max(0, Math.min(100, progress))
}

function phaseCopy(status: OnboardingStatus): OnboardingPhaseCopy {
  return PHASE_COPY[status.phase]
}

function progressLabel(status: OnboardingStatus): string {
  if (status.phase === 'ready') return 'Done'
  if (status.phase === 'error') return 'Stopped'
  return 'Working'
}

function setupMetrics(status: OnboardingStatus, selectedModel: string): Array<{ label: string; value: string }> {
  return [
    { label: 'Storage', value: 'This Mac only' },
    { label: 'AI engine', value: status.managed ? 'Managed by Gappd' : 'External' },
    { label: 'Model ID', value: selectedModel || status.model || 'Recommended' },
    { label: 'Endpoint', value: status.endpoint || 'Chosen automatically' },
  ]
}

function primaryActionLabel(status: OnboardingStatus, permission: SetupPermissionState, copy: OnboardingPhaseCopy): string {
  if (status.phase !== 'ready') return status.phase === 'error' || status.canRetry ? 'Fix setup' : copy.actionLabel
  if (permission.status === 'checking') return 'Checking permissions...'
  if (permission.status === 'granted') return 'Start using Gappd'
  if (permission.status === 'blocked' || permission.status === 'unknown' || permission.status === 'error') return 'Check again'
  return 'Allow microphone & screen/audio'
}

function setupAction(status: OnboardingStatus, permission: SetupPermissionState, onStart: () => void, onRetry: () => void, onRequestPermissions: () => void): () => void {
  if (status.phase !== 'ready') return status.phase === 'error' || status.canRetry ? onRetry : onStart
  return onRequestPermissions
}

function setupActionDisabled(status: OnboardingStatus, permission: SetupPermissionState): boolean {
  return status.phase === 'ready' && permission.status === 'checking'
}

function SetupActions({ busy, disabled, label, hint, onAction }: SetupActionsProps) {
  return (
    <div className="setup-actions">
      <div className="actions-row">
        <Button variant="primary" onClick={onAction} disabled={busy || disabled}>{busy ? 'Setting up...' : label}</Button>
      </div>
      {hint ? <div className="action-copy">{hint}</div> : null}
    </div>
  )
}

function SetupProgressCard({ status, copy }: SetupProgressCardProps) {
  const progress = status.phase === 'ready' ? 100 : hasNumericProgress(status) ? progressValue(status.progress) : null
  const messageView = onboardingMessageView(status)
  return (
    <div className="progress-block setup-card">
      <div className="progress-head">
        <span className="label">Progress</span>
        <span className="progress-copy">{progress === null ? progressLabel(status) : `${progress}%`}</span>
      </div>
      <ProgressBar value={progress} label="Local AI setup progress" />
      <div className="progress-copy">{copy.progressDetail}</div>
      {messageView ? <CurrentStep message={messageView} /> : null}
    </div>
  )
}

function CurrentStep({ message }: { message: NonNullable<ReturnType<typeof onboardingMessageView>> }) {
  return <div className="setup-progress-detail"><div className="label">Current step</div><div className="setup-progress-headline">{message.headline}</div>{message.detail ? <div className="progress-copy">{message.detail}</div> : null}</div>
}

function SetupChecklist({ status, permissionState }: { status: OnboardingStatus; permissionState: SetupPermissionState }) {
  return <Card className="setup-steps"><div><div className="label">Setup steps</div><h3>Short setup path</h3></div>{setupSteps(status, permissionState).map((step) => <SetupStepRow key={step.label} step={step} />)}</Card>
}

function SetupStepRow({ step }: { step: SetupStep }) {
  return <div className={cx('setup-step', step.state)}><span>{stepIcon(step.state)}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div></div>
}

function setupSteps(status: OnboardingStatus, permission: SetupPermissionState): SetupStep[] {
  const aiReady = status.phase === 'ready'
  return [
    { label: 'Check this Mac', detail: aiReady || status.phase !== 'checking' ? 'Done' : 'Looking for existing tools', state: status.phase === 'checking' ? 'active' : 'done' },
    { label: 'Download private tools', detail: aiReady ? 'Done' : 'Needed for transcripts and summaries', state: aiReady ? 'done' : status.phase === 'error' ? 'blocked' : 'active' },
    permissionStep(aiReady, permission),
    { label: 'Start first recording', detail: 'Dashboard opens after access is ready', state: permission.status === 'granted' ? 'active' : 'locked' },
  ]
}

function permissionStep(aiReady: boolean, permission: SetupPermissionState): SetupStep {
  if (!aiReady) return { label: 'Allow recording access', detail: 'Microphone and screen/system audio prompts come next', state: 'locked' }
  if (permission.status === 'granted') return { label: 'Allow recording access', detail: 'Done', state: 'done' }
  if (permission.status === 'blocked' || permission.status === 'error') return { label: 'Allow recording access', detail: 'Needs System Settings', state: 'blocked' }
  return { label: 'Allow recording access', detail: 'Microphone and screen/system audio', state: 'active' }
}

function stepIcon(state: SetupStepState): string {
  if (state === 'done') return '✓'
  if (state === 'blocked') return '!'
  if (state === 'active') return '•'
  return '○'
}

function PermissionSetupCard({ status, state, onOpenSettings }: { status: OnboardingStatus; state: SetupPermissionState; onOpenSettings: (target?: CapturePermissionTarget) => void }) {
  if (status.phase !== 'ready') return null
  const needsSettings = state.status === 'blocked' || state.status === 'unknown' || state.status === 'error'
  return (
    <Card className="setup-permissions">
      <div><div className="label">Recording access</div><h3>{permissionTitle(state)}</h3></div>
      <p>{permissionDetail(state)}</p>
      {needsSettings ? <PermissionButtons onOpenSettings={onOpenSettings} /> : null}
    </Card>
  )
}

function PermissionButtons({ onOpenSettings }: { onOpenSettings: (target: CapturePermissionTarget) => void }) {
  return <div className="permission-actions"><Button onClick={() => onOpenSettings('screen-recording')}>Open Screen &amp; Audio</Button><Button onClick={() => onOpenSettings('microphone')}>Open Microphone</Button></div>
}

function permissionTitle(state: SetupPermissionState): string {
  if (state.status === 'granted') return 'Access ready.'
  if (state.status === 'checking') return 'Checking microphone and screen/system audio access.'
  if (state.status === 'blocked') return 'Permission blocked.'
  if (state.status === 'unknown' || state.status === 'error') return 'Could not confirm access.'
  return 'Allow microphone and screen/system audio.'
}

function permissionDetail(state: SetupPermissionState): string {
  if (state.status === 'blocked') return 'Enable GappdCapture in Screen & System Audio Recording and Microphone, then click Check again.'
  if (state.status === 'unknown') return 'macOS did not give a clear answer. Check again or open System Settings.'
  if (state.status === 'error') return state.error || 'Permission check failed. Open System Settings, then check again.'
  return 'Gappd asks now so recording does not stop when you start your first meeting.'
}

function SetupAdvancedDetails({ status, busy, selectedModel, modelOptions, onModelChange }: Pick<OnboardingViewProps, 'status' | 'busy' | 'selectedModel' | 'modelOptions' | 'onModelChange'>) {
  const selectedOption = modelOptions.find((option) => option.tag === selectedModel)
  const disabled = busy || (status.phase !== 'needs_setup' && status.phase !== 'error')
  return (
    <details className="setup-advanced">
      <summary>Advanced setup</summary>
      <div className="setup-advanced-body settings-stack">
        <Field label="Quality" className="setup-model-picker" hint={selectedOption?.detail}>
          <select value={selectedModel} onChange={(event) => updateSelectedModel(event.currentTarget.value, onModelChange)} disabled={disabled}>
            {modelOptions.map((option) => <option key={option.tag} value={option.tag}>{option.label}</option>)}
          </select>
        </Field>
        <div className="setup-metrics">
          {setupMetrics(status, selectedModel).map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} />)}
        </div>
      </div>
    </details>
  )
}

function updateSelectedModel(value: string, onModelChange: (model: ManagedOllamaModelTag) => void): void {
  if (isManagedOllamaModel(value)) onModelChange(value)
}

function SetupHero({ copy }: { copy: OnboardingPhaseCopy }) {
  return (
    <Card className="setup-callout accent">
      <strong>Private by default</strong><h2>{copy.headline}</h2><p>{copy.detail}</p>
      <ul className="setup-benefits"><li>Everything stays on this Mac.</li><li>Downloads several GB once.</li><li>Typical setup takes 5-10 minutes.</li></ul>
    </Card>
  )
}

function SetupBody(props: OnboardingViewProps & { copy: OnboardingPhaseCopy }) {
  const view = setupView(props)
  return (
    <div className="setup-panel setup-primary">
      <SetupHero copy={props.copy} />
      <SetupChecklist status={props.status} permissionState={props.permissionState} />
      {props.status.phase !== 'ready' ? <SetupProgressCard status={props.status} copy={props.copy} /> : null}
      <PermissionSetupCard status={props.status} state={props.permissionState} onOpenSettings={props.onOpenPermissionsSettings} />
      <SetupActions busy={props.busy} disabled={view.disabled} label={view.label} hint={view.hint} onAction={view.action} />
      {view.error ? <LocalAIErrorBanner errorView={view.error} /> : null}
      <SetupAdvancedDetails {...props} />
    </div>
  )
}

function setupView(props: OnboardingViewProps & { copy: OnboardingPhaseCopy }) {
  const isError = props.status.phase === 'error'
  return {
    action: setupAction(props.status, props.permissionState, props.onStart, props.onRetry, props.onRequestPermissions),
    disabled: setupActionDisabled(props.status, props.permissionState),
    error: onboardingErrorView(props.status),
    hint: props.status.phase !== 'ready' && !isError && props.status.phase !== 'needs_setup' ? props.copy.actionHint : undefined,
    label: primaryActionLabel(props.status, props.permissionState, props.copy),
  }
}

export function OnboardingView(props: OnboardingViewProps) {
  return (
    <Panel className="panel-large setup-shell">
      <PageHeader title="Get Gappd ready" description="Record, transcribe, and summarize meetings privately on this Mac." action={<StatusPill tone={onboardingStatusTone(props.status.phase)}>{onboardingPhaseLabel(props.status.phase)}</StatusPill>} />
      <div className="setup-grid"><SetupBody {...props} copy={phaseCopy(props.status)} /></div>
    </Panel>
  )
}
