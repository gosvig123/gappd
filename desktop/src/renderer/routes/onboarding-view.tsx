import '../components/local-ai.css'

import {
  onboardingErrorView,
  onboardingMessageView,
  onboardingPhaseLabel,
  onboardingStatusTone,
  type OnboardingStatus,
} from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'
import { Button, Card, Field, MetricCard, PageHeader, Panel, ProgressBar, StatusPill } from '../components/ui'
import { isManagedOllamaModel, type ManagedOllamaModelOption, type ManagedOllamaModelTag } from '../../shared/bundled-ollama'

type OnboardingViewProps = {
  status: OnboardingStatus
  busy: boolean
  selectedModel: ManagedOllamaModelTag
  modelOptions: readonly ManagedOllamaModelOption[]
  onModelChange: (model: ManagedOllamaModelTag) => void
  onStart: () => void
  onRetry: () => void
  onContinue: () => void
}

type SetupActionsProps = {
  busy: boolean
  isReady: boolean
  label: string
  hint?: string
  showRetry: boolean
  onAction: () => void
  onRetry: () => void
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

const PHASE_COPY: Record<OnboardingStatus['phase'], OnboardingPhaseCopy> = {
  checking: { headline: 'Checking your local AI setup.', detail: 'Looking for the bundled Ollama runtime and any model files already on this Mac.', progressDetail: 'Confirming what is already installed before setup continues.', actionLabel: 'Checking setup...' },
  needs_setup: { headline: 'Install once. Keep recordings local.', detail: 'Start the bundled runtimes and download the recommended local models for this Mac.', progressDetail: 'Setup downloads the managed models, then saves the local runtime settings.', actionLabel: 'Set up local AI' },
  starting_ollama: { headline: 'Starting the bundled Ollama runtime.', detail: 'Gappd is launching the managed local service used for recordings on this Mac.', progressDetail: 'This step usually finishes quickly once the local runtime is ready.', actionLabel: 'Starting Ollama...' },
  pulling_model: { headline: 'Downloading the recommended local models.', detail: 'First-time setup can take several minutes depending on your connection and disk speed.', progressDetail: 'Keep Gappd open while the downloads continue in the background.', actionLabel: 'Downloading models...', actionHint: 'Large model downloads can look quiet between updates. Gappd keeps working until setup finishes or an error appears.' },
  saving_config: { headline: 'Finishing local AI setup.', detail: 'The download is done. Gappd is saving the managed runtime settings for future recordings.', progressDetail: 'Almost done. This step stores the bundled runtime configuration.', actionLabel: 'Finishing setup...' },
  ready: { headline: 'Local AI is ready.', detail: 'The bundled Ollama runtime is configured and recordings stay on this Mac.', progressDetail: 'Setup complete. You can start using local AI now.', actionLabel: 'Ready' },
  error: { headline: 'Local AI setup needs attention.', detail: 'Setup stopped before the bundled Ollama flow finished. Review the error and try again.', progressDetail: 'Setup paused because an error interrupted the managed runtime flow.', actionLabel: 'Retry setup' },
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
  if (status.phase === 'ready') return 'Complete'
  if (status.phase === 'error') return 'Stopped'
  return 'Working'
}

function planMetrics(status: OnboardingStatus, selectedModel: string): Array<{ label: string; value: string }> {
  return [
    { label: 'Mode', value: status.managed ? 'Managed' : 'External' },
    { label: 'Model', value: selectedModel || status.model || 'Recommended default' },
    { label: 'Endpoint', value: status.endpoint || 'Configured during setup' },
    { label: 'Updates', value: 'Live phase events' },
  ]
}

function SetupActions({ busy, isReady, label, hint, showRetry, onAction, onRetry }: SetupActionsProps) {
  return (
    <>
      <div className="actions-row">
        <Button variant="primary" onClick={onAction} disabled={busy || isReady}>{label}</Button>
        {showRetry ? <Button onClick={onRetry} disabled={busy}>Retry</Button> : null}
      </div>
      {hint ? <div className="action-copy">{hint}</div> : null}
    </>
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
      {messageView ? (
        <div className="setup-progress-detail">
          <div className="label">Latest update</div>
          <div className="setup-progress-headline">{messageView.headline}</div>
          {messageView.detail ? <div className="progress-copy">{messageView.detail}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function SetupPlanRail({ status, busy, selectedModel, modelOptions, onModelChange }: Pick<OnboardingViewProps, 'status' | 'busy' | 'selectedModel' | 'modelOptions' | 'onModelChange'>) {
  const selectedOption = modelOptions.find((option) => option.tag === selectedModel)
  const disabled = busy || status.phase !== 'needs_setup' && status.phase !== 'error'
  return (
    <aside className="setup-panel setup-rail settings-stack">
      <div><h2>Plan</h2><p>Choose local AI model before setup. Default stays selected unless you choose faster setup.</p></div>
      <Field label="Model" className="setup-model-picker" hint={selectedOption?.detail}>
        <select value={selectedModel} onChange={(event) => updateSelectedModel(event.currentTarget.value, onModelChange)} disabled={disabled}>
          {modelOptions.map((option) => <option key={option.tag} value={option.tag}>{option.label}</option>)}
        </select>
      </Field>
      <div className="setup-metrics">
        {planMetrics(status, selectedModel).map((metric) => (
          <MetricCard key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>
      <div className="status-note">After setup, Dashboard unlocks. Settings keeps a repair action for the local runtime.</div>
    </aside>
  )
}

function updateSelectedModel(value: string, onModelChange: (model: ManagedOllamaModelTag) => void): void {
  if (isManagedOllamaModel(value)) onModelChange(value)
}

export function OnboardingView({ status, busy, selectedModel, modelOptions, onModelChange, onStart, onRetry, onContinue }: OnboardingViewProps) {
  const copy = phaseCopy(status)
  const errorView = onboardingErrorView(status)
  const isReady = status.phase === 'ready'
  const isError = status.phase === 'error'
  const action = isError ? onRetry : onStart
  const hint = !isReady && !isError && status.phase !== 'needs_setup' ? copy.actionHint : undefined
  return (
    <Panel className="panel-large setup-shell">
      <PageHeader title="Local AI setup" description="Bundled Ollama and Whisper on this Mac." action={<StatusPill tone={onboardingStatusTone(status.phase)}>{onboardingPhaseLabel(status.phase)}</StatusPill>} />
      <div className="setup-grid">
        <div className="setup-panel setup-primary">
          <Card className="setup-callout accent"><strong>Recommended</strong><h2>{copy.headline}</h2><p>{copy.detail}</p></Card>
          <SetupProgressCard status={status} copy={copy} />
          {isReady ? (
            <div className="actions-row"><Button variant="primary" onClick={onContinue}>Go to Dashboard</Button></div>
          ) : (
            <SetupActions busy={busy} isReady={isReady} label={copy.actionLabel} hint={hint} showRetry={status.canRetry && !isError} onAction={action} onRetry={onRetry} />
          )}
          {errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}
        </div>
        <SetupPlanRail status={status} busy={busy} selectedModel={selectedModel} modelOptions={modelOptions} onModelChange={onModelChange} />
      </div>
    </Panel>
  )
}
