import { buildOwnershipHelp, type LocalAIOwnershipHelp } from './local-ai-ownership'

type LocalAIContract = Pick<typeof window.gappd, 'localAISetup'>

export type LocalAISetupStatus = Awaited<ReturnType<LocalAIContract['localAISetup']['getStatus']>>
export type LocalAIStatus = Awaited<ReturnType<LocalAIContract['localAISetup']['getDetails']>>

type LocalAISetupMessageView = {
  headline: string
  detail?: string
  compact: string
}

type LocalAISetupErrorView = {
  title: string
  detail?: string
  errorDetail?: string
  debugDetail?: string
  compact: string
  ownershipHelp?: LocalAIOwnershipHelp
}

const PULL_STAGE_VIEWS: Record<NonNullable<LocalAISetupStatus['pullStage']>, LocalAISetupMessageView> = {
  preparing: { headline: 'Preparing download', compact: 'Preparing download.' },
  downloading: { headline: 'Downloading tools', compact: 'Downloading tools.' },
  verifying: { headline: 'Checking download', compact: 'Checking download.' },
  finalizing: { headline: 'Finishing install', compact: 'Finishing install.' },
  complete: { headline: 'Download complete', compact: 'Download complete.' },
}

const ERROR_VIEWS: Record<NonNullable<LocalAISetupStatus['errorKind']>, Omit<LocalAISetupErrorView, 'debugDetail' | 'ownershipHelp'>> = {
  pull_timeout: { title: 'Download took too long.', detail: 'Check your connection, then click Fix setup.', compact: 'Download timed out.' },
  pull_network: { title: 'Download was interrupted.', detail: 'Check your connection, then click Fix setup.', compact: 'Download interrupted.' },
  pull_blob_host_network: { title: 'Gappd could not reach the download host.', detail: 'Check VPN, firewall, or network filters, then click Fix setup.', compact: 'Download host unavailable.' },
  disk_space: { title: 'Not enough disk space.', detail: 'Free some space on this Mac, then click Fix setup.', compact: 'Need more disk space.' },
  permission: { title: 'Gappd could not update local AI files.', detail: 'Check file permissions on this Mac, then retry setup.', compact: 'File permission issue.' },
  ownership_mismatch: { title: "Another process is using Gappd's local port.", detail: 'Gappd needs its local port for the managed runtime. Stop the other process manually, then retry setup.', compact: 'Local port already in use.' },
  runtime: { title: 'Bundled runtime needs attention.', compact: 'Bundled runtime needs attention.' },
}

const GENERIC_PHASE_MESSAGES: Record<LocalAISetupStatus['phase'], string[]> = {
  checking: ['checking managed runtime', 'checking your local ai setup'],
  needs_setup: ['local ai setup is required'],
  starting_runtime: ['managed llama.cpp is running', 'starting the bundled runtime'],
  pulling_model: ['pulling local model', 'downloading the recommended local model'],
  saving_config: ['saving local ai configuration', 'finishing local ai setup'],
  ready: ['local ai is ready'],
  error: ['managed local ai setup failed', 'local ai setup needs attention'],
}

const STATUS_DELIMITERS = [' -- ', ' - ', ' | ', ': ']

export function getLocalAIContract(): LocalAIContract {
  return window.gappd
}

export function localAISetupPhaseLabel(phase: LocalAISetupStatus['phase']): string {
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

export function localAISetupStatusTone(phase: LocalAISetupStatus['phase']): 'idle' | 'processing' | 'error' {
  if (phase === 'ready') return 'idle'
  if (phase === 'error') return 'error'
  return 'processing'
}

export function localAISetupMessageView(status: Pick<LocalAISetupStatus, 'phase' | 'message' | 'progress' | 'pullStage'>): LocalAISetupMessageView | null {
  const pullView = localAISetupPullStageView(status)
  if (pullView) return pullView
  const text = cleanStatusText(status.message, typeof status.progress === 'number')
  if (!text || isGenericPhaseMessage(status.phase, text)) return null
  const [headline, detail] = splitStatusText(text)
  return { headline, detail, compact: truncateText(detail || headline, 72) }
}

export function localAISetupErrorView(status: Pick<LocalAISetupStatus, 'debugDetail' | 'error' | 'errorDetail' | 'errorKind' | 'ownershipConflict'> | null | undefined): LocalAISetupErrorView | null {
  if (!status?.error || !status.errorKind) return null
  return structuredErrorView(status)
}

export function toStatusError(error: unknown): LocalAIStatus {
  return {
    phase: 'error',
    managed: true,
    endpoint: '',
    model: '',
    message: 'Local AI unavailable.',
    error: error instanceof Error ? error.message : String(error),
    errorKind: 'runtime',
    canRetry: true,
    supported: false,
    configured: false,
    bundled: false,
    running: false,
    canRepair: false,
  }
}

function cleanStatusText(message: string, hasProgress: boolean): string {
  const withoutOutput = normalizeText(message.split(/recent runtime output:/i)[0] || '')
  if (!withoutOutput) return ''
  const withoutPercent = hasProgress ? normalizeText(withoutOutput.replace(/\b\d{1,3}%\b/g, '')) : withoutOutput
  return truncateText(withoutPercent.replace(/\s+[-|:]\s*$/, ''), 120)
}

function cleanErrorText(message: string | undefined): string {
  return truncateText(normalizeText((message || '').split(/recent runtime output:/i)[0] || ''), 180)
}

function cleanDebugDetail(detail: string | undefined): string | undefined {
  const text = (detail || '').trim()
  return text ? truncateText(text, 1200) : undefined
}

function localAISetupPullStageView(status: Pick<LocalAISetupStatus, 'phase' | 'message' | 'progress' | 'pullStage'>): LocalAISetupMessageView | null {
  if (status.phase !== 'pulling_model' || !status.pullStage) return null
  return { ...PULL_STAGE_VIEWS[status.pullStage], detail: cleanPullDetail(status) }
}

function structuredErrorView(status: Pick<LocalAISetupStatus, 'debugDetail' | 'error' | 'errorDetail' | 'errorKind' | 'ownershipConflict'>): LocalAISetupErrorView {
  const view = ERROR_VIEWS[status.errorKind!]
  const errorDetail = status.errorDetail || (status.errorKind === 'runtime' ? cleanErrorText(status.error) : undefined)
  return { ...view, detail: errorDetail || view.detail, errorDetail, debugDetail: cleanDebugDetail(status.debugDetail), ownershipHelp: status.errorKind === 'ownership_mismatch' ? buildOwnershipHelp(status.ownershipConflict) : undefined }
}

function splitStatusText(text: string): [string, string | undefined] {
  for (const delimiter of STATUS_DELIMITERS) {
    const parts = text.split(delimiter)
    if (parts.length > 1) return [parts[0], normalizeText(parts.slice(1).join(delimiter)) || undefined]
  }
  return [text, undefined]
}

function isGenericPhaseMessage(phase: LocalAISetupStatus['phase'], text: string): boolean {
  return GENERIC_PHASE_MESSAGES[phase].includes(normalizeKey(text))
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase()
}

function cleanPullDetail(status: Pick<LocalAISetupStatus, 'phase' | 'message' | 'progress' | 'pullStage'>): string | undefined {
  const text = cleanStatusText(status.message, typeof status.progress === 'number')
  if (!text || isGenericPhaseMessage(status.phase, text)) return undefined
  if (status.pullStage && normalizeKey(text) === normalizeKey(PULL_STAGE_VIEWS[status.pullStage].headline)) return undefined
  return text
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}...`
}
