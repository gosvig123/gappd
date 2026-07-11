import type { ManagedRuntimeSnapshot } from './managed-runtime-contract'
import { runtimeErrorView, runtimeMessageView } from './managed-runtime-contract'
import { LocalAIErrorBanner } from './local-ai-error-banner'
import { Banner, Button, ProgressBar } from './ui'

type Props = {
  snapshot: ManagedRuntimeSnapshot
  busy: boolean
  onSetup: () => void
  onRepair: () => void
}

export function ManagedRuntimeBanner({ snapshot, busy, onSetup, onRepair }: Props) {
  if (snapshot.operation === 'ready') return null
  const active = busy || ['checking', 'pulling_model', 'saving_config', 'starting_runtime'].includes(snapshot.operation)
  const error = runtimeErrorView(snapshot)
  const message = runtimeMessageView(snapshot)
  const action = snapshot.operation === 'needs_setup' ? onSetup : onRepair
  return <Banner tone={snapshot.operation === 'error' ? 'error' : 'info'} title={title(snapshot)} actions={<Button variant="primary" onClick={action} disabled={active}>{active ? 'Preparing…' : snapshot.operation === 'needs_setup' ? 'Set up Local AI' : 'Repair Local AI'}</Button>}>
    <p>{message?.compact || snapshot.message}</p>
    {active ? <ProgressBar value={snapshot.progress ?? null} label="Managed Runtime preparation" /> : null}
    {error ? <LocalAIErrorBanner errorView={error} /> : null}
  </Banner>
}

function title(snapshot: ManagedRuntimeSnapshot): string {
  if (snapshot.operation === 'error') return 'Local AI needs attention'
  if (snapshot.operation === 'needs_setup') return 'Set up Local AI for transcripts and summaries'
  return 'Preparing Local AI'
}
