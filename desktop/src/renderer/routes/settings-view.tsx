import '../components/local-ai.css'

import { Button, MetricCard, PageHeader, StatusPill } from '../components/ui'
import { onboardingErrorView, onboardingPhaseLabel, onboardingStatusTone, type LocalAIStatus } from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type SettingsViewProps = {
  status: LocalAIStatus | null
  loading: boolean
  busy: boolean
  onRepair: () => void
}

const SETTINGS_METRICS: Array<{ label: string; value: (status: LocalAIStatus | null) => string }> = [
  { label: 'Supported', value: (status) => flagLabel(status, 'supported') },
  { label: 'Configured', value: (status) => flagLabel(status, 'configured') },
  { label: 'Bundled', value: (status) => flagLabel(status, 'bundled') },
  { label: 'Running', value: (status) => flagLabel(status, 'running') },
  { label: 'Model', value: (status) => status?.model || 'Unknown' },
  { label: 'Endpoint', value: (status) => status?.endpoint || 'Unknown' },
]

function flagLabel(status: LocalAIStatus | null, key: 'supported' | 'configured' | 'bundled' | 'running'): string {
  if (!status) return 'Unknown'
  return status[key] ? 'Yes' : 'No'
}

export function SettingsView({ status, loading, busy, onRepair }: SettingsViewProps) {
  const errorView = onboardingErrorView(status)
  return (
    <section className="settings-stack settings-stack-plain">
      <PageHeader title="Local AI" description="Runtime health on this Mac." action={<StatusPill tone={status ? onboardingStatusTone(status.phase) : 'processing'}>{loading ? 'Checking' : onboardingPhaseLabel(status?.phase ?? 'checking')}</StatusPill>} />
      <div className="settings-grid">
        {SETTINGS_METRICS.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value(status)} />)}
      </div>
      <div className="status-note">{status?.message || 'Check local AI status and repair the managed runtime if needed.'}</div>
      {errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}
      <div className="actions-row">
        <Button variant="primary" onClick={onRepair} disabled={loading || busy || !status || !status.canRepair}>{busy ? 'Repairing...' : 'Repair local AI'}</Button>
      </div>
    </section>
  )
}

