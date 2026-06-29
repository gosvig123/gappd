import type { LocalAISetupErrorDebug, LocalAISetupErrorKind, LocalAISetupPhase, LocalAISetupStatus } from '../shared/contracts'
import { buildErrorDebug, readErrorDebug, readOwnershipConflict } from './local-ai-setup-error-debug'

type ErrorLike = Record<string, unknown>
type PullFailure = { summary: string; detail?: string; debug?: LocalAISetupErrorDebug; errorKind?: LocalAISetupErrorKind }
type PullFailureError = Error & { detail?: string; debug?: LocalAISetupErrorDebug; errorKind?: LocalAISetupErrorKind }
type PullStallController = { refresh: () => void; clear: () => void; errorFor: (error: unknown) => Error }

export type LocalAISetupErrorState = {
  error: string
  errorDetail?: LocalAISetupStatus['errorDetail']
  debugDetail?: LocalAISetupStatus['debugDetail']
  errorDebug?: LocalAISetupStatus['errorDebug']
  errorKind: NonNullable<LocalAISetupStatus['errorKind']>
  ownershipConflict?: LocalAISetupStatus['ownershipConflict']
}

const OLLAMA_PULL_STALL_TIMEOUT_PRE_BYTES_MS = 90_000
const OLLAMA_PULL_STALL_TIMEOUT_POST_BYTES_MS = 300_000
const BLOB_HOST_MARKERS = ['cloudflarestorage.com']
const DISK_SPACE_MARKERS = ['no space', 'disk full', 'enospc', 'not enough space']
const NETWORK_MARKERS = ['network', 'connection', 'dns', 'econn', 'socket', 'fetch', 'registry', 'dial tcp', 'connection refused', 'no such host', 'network is unreachable', 'econnrefused', 'econnreset', 'enetunreach', 'ehostunreach', 'enotfound', 'eai_again']
const OWNERSHIP_MARKERS = ['another ollama process', 'app-owned runtime', 'ownership mismatch', '127.0.0.1:11435']
const PERMISSION_MARKERS = ['permission denied', 'operation not permitted', 'access denied', 'eacces']
const TIMEOUT_MARKERS = ['i/o timeout', 'timed out', 'timeout', 'pull stalled', 'stalled with no new progress', 'etimedout', 'headers timeout', 'body timeout', 'connect timeout', 'und_err_connect_timeout']

export function createPullStallController(controller: AbortController, getLastMessage: () => string | undefined, hasByteProgress: () => boolean): PullStallController {
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let stalled = false
  const clear = () => {
    if (!stallTimer) return
    clearTimeout(stallTimer)
    stallTimer = null
  }
  return {
    refresh: () => {
      clear()
      stallTimer = setTimeout(() => { stalled = true; controller.abort() }, pullStallTimeoutMs(hasByteProgress()))
    },
    clear,
    errorFor: (error: unknown) => stalled ? new Error(stalledPullMessage(getLastMessage())) : normalizeTransportError(error),
  }
}

export function normalizeTransportError(error: unknown): Error {
  if (isPullFailureError(error)) return error
  return createPullFailureError(...collectErrorDetails(error))
}

export function createPullFailureError(...details: string[]): Error {
  return buildPullFailureError(describePullFailure(...details))
}

export function toLocalAISetupErrorState(error: unknown, phase: LocalAISetupPhase, fallback: string): LocalAISetupErrorState {
  const details = collectErrorDetails(error)
  const summary = normalizeText(readErrorString(error, 'message') || readErrorMessage(error) || fallback) || fallback
  const errorDetail = normalizeText(readErrorString(error, 'detail'))
  const errorDebug = readErrorDebug(error) || buildErrorDebug(details, errorDetail || summary)
  const ownershipConflict = readOwnershipConflict(error)
  return { error: summary, errorDetail, debugDetail: errorDebug?.rawDetail, errorDebug, errorKind: classifyLocalAISetupErrorKind(summary, phase, errorDetail, errorDebug), ownershipConflict }
}

export function classifyLocalAISetupErrorKind(message: string | undefined, phase: LocalAISetupPhase, detail?: string, debug?: LocalAISetupErrorDebug): LocalAISetupErrorKind {
  const value = normalizeErrorText([message, detail, debug?.rawDetail, debug?.host, debug?.url, debug?.ip].filter(Boolean).join(' '))
  if (matchesAny(value, DISK_SPACE_MARKERS)) return 'disk_space'
  if (matchesAny(value, OWNERSHIP_MARKERS)) return 'ownership_mismatch'
  if (matchesAny(value, PERMISSION_MARKERS)) return 'permission'
  if (phase === 'pulling_model' && isPullBlobHostNetwork(value)) return 'pull_blob_host_network'
  if (phase === 'pulling_model' && matchesAny(value, TIMEOUT_MARKERS)) return 'pull_timeout'
  if (phase === 'pulling_model' && matchesAny(value, NETWORK_MARKERS)) return 'pull_network'
  return 'runtime'
}

function describePullFailure(...details: string[]): PullFailure {
  const rawDetail = preferredDetail(details)
  const debug = buildErrorDebug(details, rawDetail)
  if (isPullBlobHostNetwork([debug?.host, debug?.url, ...details].filter(Boolean).join(' '))) return pullFailure('Managed Ollama could not reach the model download host. Check your internet connection, VPN, or firewall, then retry Local AI setup.', 'pull_blob_host_network', debug, 'Download host')
  if (matchesDetail(details, TIMEOUT_MARKERS)) return pullFailure('Managed Ollama timed out while downloading the model. Check your network connection, then retry Local AI setup.', 'pull_timeout', debug, 'Reachability target')
  if (matchesDetail(details, NETWORK_MARKERS)) return pullFailure('Managed Ollama could not reach the model registry. Check your internet connection, VPN, or firewall, then retry Local AI setup.', 'pull_network', debug, 'Reachability target')
  return { summary: rawDetail?.startsWith('Managed Ollama') ? rawDetail : 'Managed Ollama model download failed.', debug }
}

function pullFailure(summary: string, errorKind: LocalAISetupErrorKind, debug?: LocalAISetupErrorDebug, label?: string): PullFailure {
  return { summary, detail: reachabilityDetail(debug, label || 'Reachability target'), debug, errorKind }
}

function collectErrorDetails(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return []
  seen.add(error)
  if (typeof error === 'string') return [error]
  if (typeof error !== 'object') return []
  const cause = 'cause' in error ? error.cause : undefined
  return readNamedDetails(error).concat(collectErrorDetails(cause, seen)).filter((detail): detail is string => Boolean(detail?.trim()))
}

function readNamedDetails(error: object): Array<string | undefined> {
  return [readStringField(error, 'message'), readStringField(error, 'detail'), readStringField(error, 'code'), readStringField(error, 'name')]
}

function readStringField(value: object, key: 'code' | 'detail' | 'message' | 'name'): string | undefined {
  if (!(key in value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function buildPullFailureError(failure: PullFailure): Error {
  const error = new Error(failure.summary) as PullFailureError
  if (failure.detail) error.detail = failure.detail
  if (failure.debug) error.debug = failure.debug
  if (failure.errorKind) error.errorKind = failure.errorKind
  return error
}

function isPullFailureError(error: unknown): error is PullFailureError {
  return error instanceof Error && ('detail' in error || 'debug' in error || 'errorKind' in error)
}

function isPullBlobHostNetwork(value: string): boolean {
  const normalized = normalizeErrorText(value)
  return matchesAny(normalized, BLOB_HOST_MARKERS) && (matchesAny(normalized, TIMEOUT_MARKERS) || matchesAny(normalized, NETWORK_MARKERS))
}

function reachabilityDetail(debug: LocalAISetupErrorDebug | undefined, label: string): string | undefined {
  if (!debug?.host && !debug?.ip) return undefined
  const target = debug.host && debug.ip ? `${debug.host} (${debug.ip})` : debug.host || debug.ip
  return `${label}: ${target}.`
}

function readErrorMessage(error: unknown): string | undefined {
  return typeof error === 'string' ? error : undefined
}

function readErrorString(error: unknown, key: 'detail' | 'message'): string | undefined {
  if (!error || typeof error !== 'object' || !(key in error)) return undefined
  const value = (error as ErrorLike)[key]
  return typeof value === 'string' ? value : undefined
}

function preferredDetail(details: string[]): string | undefined {
  return details.map((detail) => detail.trim()).find(Boolean)
}

function stalledPullMessage(lastMessage?: string): string {
  const detail = lastMessage ? ` Last status: ${lastMessage}.` : ''
  return `Managed Ollama model download stalled with no new progress. Check your network connection, then retry Local AI setup.${detail}`
}

function pullStallTimeoutMs(hasByteProgress: boolean): number {
  return hasByteProgress ? OLLAMA_PULL_STALL_TIMEOUT_POST_BYTES_MS : OLLAMA_PULL_STALL_TIMEOUT_PRE_BYTES_MS
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeErrorText(message: string | undefined): string {
  return (message || '').trim().toLowerCase()
}

function matchesDetail(details: string[], markers: string[]): boolean {
  return matchesAny(details.join(' ').toLowerCase(), markers)
}

function matchesAny(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker))
}
