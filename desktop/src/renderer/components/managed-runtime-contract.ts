import { buildOwnershipHelp, type LocalAIOwnershipHelp } from './local-ai-ownership'

type ManagedRuntimeContract = Pick<typeof window.gappd, 'managedRuntime'>

export type ManagedRuntimeSnapshot = Awaited<ReturnType<ManagedRuntimeContract['managedRuntime']['status']>>

type RuntimeErrorView = {
  title: string
  detail?: string
  errorDetail?: string
  debugDetail?: string
  compact: string
  ownershipHelp?: LocalAIOwnershipHelp
}

const ERROR_VIEWS: Record<NonNullable<ManagedRuntimeSnapshot['errorKind']>, Omit<RuntimeErrorView, 'debugDetail' | 'ownershipHelp'>> = {
  pull_timeout: { title: 'Download took too long.', detail: 'Check your connection, then click Fix setup.', compact: 'Download timed out.' },
  pull_network: { title: 'Download was interrupted.', detail: 'Check your connection, then click Fix setup.', compact: 'Download interrupted.' },
  pull_blob_host_network: { title: 'Gappd could not reach the download host.', detail: 'Check VPN, firewall, or network filters, then click Fix setup.', compact: 'Download host unavailable.' },
  disk_space: { title: 'Not enough disk space.', detail: 'Free some space on this Mac, then click Fix setup.', compact: 'Need more disk space.' },
  permission: { title: 'Gappd could not update local AI files.', detail: 'Check file permissions on this Mac, then retry setup.', compact: 'File permission issue.' },
  ownership_mismatch: { title: "Another process is using Gappd's local port.", detail: 'Gappd needs its local port for the managed runtime. Stop the other process manually, then retry setup.', compact: 'Local port already in use.' },
  runtime: { title: 'Bundled runtime needs attention.', compact: 'Bundled runtime needs attention.' },
}

export function getManagedRuntimeContract(): ManagedRuntimeContract {
  return window.gappd
}

export function runtimeOperationLabel(phase: ManagedRuntimeSnapshot['operation']): string {
  switch (phase) {
    case 'checking': return 'Checking'
    case 'needs_setup': return 'Setup needed'
    case 'starting_runtime': return 'Starting'
    case 'pulling_model': return 'Downloading'
    case 'saving_config': return 'Finishing'
    case 'ready': return 'Ready'
    case 'error': return 'Needs attention'
  }
}

export function runtimeStatusTone(phase: ManagedRuntimeSnapshot['operation']): 'idle' | 'processing' | 'error' {
  if (phase === 'ready') return 'idle'
  if (phase === 'error') return 'error'
  return 'processing'
}

export function runtimeErrorView(status: Pick<ManagedRuntimeSnapshot, 'debugDetail' | 'error' | 'errorDetail' | 'errorKind' | 'ownershipConflict'> | null | undefined): RuntimeErrorView | null {
  if (!status?.error || !status.errorKind) return null
  return structuredErrorView(status)
}

export function toStatusError(error: unknown): ManagedRuntimeSnapshot {
  return {
    operation: 'error', activity: 'idle', endpoint: '', model: '', message: 'Local AI unavailable.',
    error: error instanceof Error ? error.message : String(error), errorKind: 'runtime',
    canRetry: true, canRepair: false, supported: false, configured: false, bundled: false, running: false,
    capabilities: { summarization: { readiness: 'unavailable' }, transcription: { readiness: 'unavailable' }, diarization: { readiness: 'unavailable' } },
  }
}

function cleanErrorText(message: string | undefined): string {
  return truncateText(normalizeText((message || '').split(/recent runtime output:/i)[0] || ''), 180)
}

function cleanDebugDetail(detail: string | undefined): string | undefined {
  const text = (detail || '').trim()
  return text ? truncateText(text, 1200) : undefined
}

function structuredErrorView(status: Pick<ManagedRuntimeSnapshot, 'debugDetail' | 'error' | 'errorDetail' | 'errorKind' | 'ownershipConflict'>): RuntimeErrorView {
  const view = ERROR_VIEWS[status.errorKind!]
  const errorDetail = status.errorDetail || (status.errorKind === 'runtime' ? cleanErrorText(status.error) : undefined)
  return { ...view, detail: errorDetail || view.detail, errorDetail, debugDetail: cleanDebugDetail(status.debugDetail), ownershipHelp: status.errorKind === 'ownership_mismatch' ? buildOwnershipHelp(status.ownershipConflict) : undefined }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}...`
}
