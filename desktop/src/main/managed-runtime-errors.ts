import type { ManagedRuntimeErrorDebug, ManagedRuntimeErrorKind, ManagedRuntimeOperation, ManagedRuntimeSnapshot, OwnershipConflict } from '../shared/contracts'

type ErrorLike = Record<string, unknown>

export type ManagedRuntimeErrorState = {
  error: string
  errorDetail?: ManagedRuntimeSnapshot['errorDetail']
  debugDetail?: ManagedRuntimeSnapshot['debugDetail']
  errorDebug?: ManagedRuntimeSnapshot['errorDebug']
  errorKind: NonNullable<ManagedRuntimeSnapshot['errorKind']>
  ownershipConflict?: ManagedRuntimeSnapshot['ownershipConflict']
}

const BLOB_HOST_MARKERS = ['cloudflarestorage.com']
const DISK_SPACE_MARKERS = ['no space', 'disk full', 'enospc', 'not enough space']
const NETWORK_MARKERS = ['network', 'connection', 'dns', 'econn', 'socket', 'fetch', 'registry', 'dial tcp', 'connection refused', 'no such host', 'network is unreachable', 'econnrefused', 'econnreset', 'enetunreach', 'ehostunreach', 'enotfound', 'eai_again']
const OWNERSHIP_MARKERS = ['another process', 'app-owned runtime', 'ownership mismatch', '127.0.0.1:11436']
const PERMISSION_MARKERS = ['permission denied', 'operation not permitted', 'access denied', 'eacces']
const TIMEOUT_MARKERS = ['i/o timeout', 'timed out', 'timeout', 'pull stalled', 'stalled with no new progress', 'etimedout', 'headers timeout', 'body timeout', 'connect timeout', 'und_err_connect_timeout']

export function toManagedRuntimeErrorState(error: unknown, phase: ManagedRuntimeOperation, defaultMessage: string): ManagedRuntimeErrorState {
  const details = collectErrorDetails(error)
  const summary = normalizeText(readErrorString(error, 'message') || readErrorMessage(error) || defaultMessage) || defaultMessage
  const errorDetail = normalizeText(readErrorString(error, 'detail'))
  const errorDebug = readErrorDebug(error) || buildErrorDebug(details, errorDetail || summary)
  const ownershipConflict = readOwnershipConflict(error)
  return { error: summary, errorDetail, debugDetail: errorDebug?.rawDetail, errorDebug, errorKind: classifyManagedRuntimeErrorKind(summary, phase, errorDetail, errorDebug), ownershipConflict }
}

function classifyManagedRuntimeErrorKind(message: string | undefined, phase: ManagedRuntimeOperation, detail?: string, debug?: ManagedRuntimeErrorDebug): ManagedRuntimeErrorKind {
  const value = normalizeErrorText([message, detail, debug?.rawDetail, debug?.host, debug?.url, debug?.ip].filter(Boolean).join(' '))
  if (matchesAny(value, DISK_SPACE_MARKERS)) return 'disk_space'
  if (matchesAny(value, OWNERSHIP_MARKERS)) return 'ownership_mismatch'
  if (matchesAny(value, PERMISSION_MARKERS)) return 'permission'
  if (phase === 'pulling_model' && isPullBlobHostNetwork(value)) return 'pull_blob_host_network'
  if (phase === 'pulling_model' && matchesAny(value, TIMEOUT_MARKERS)) return 'pull_timeout'
  if (phase === 'pulling_model' && matchesAny(value, NETWORK_MARKERS)) return 'pull_network'
  return 'runtime'
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

function isPullBlobHostNetwork(value: string): boolean {
  const normalized = normalizeErrorText(value)
  return matchesAny(normalized, BLOB_HOST_MARKERS) && (matchesAny(normalized, TIMEOUT_MARKERS) || matchesAny(normalized, NETWORK_MARKERS))
}

function readErrorMessage(error: unknown): string | undefined {
  return typeof error === 'string' ? error : undefined
}

function readErrorString(error: unknown, key: 'detail' | 'message'): string | undefined {
  if (!error || typeof error !== 'object' || !(key in error)) return undefined
  const value = (error as ErrorLike)[key]
  return typeof value === 'string' ? value : undefined
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeErrorText(message: string | undefined): string {
  return (message || '').trim().toLowerCase()
}

function matchesAny(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker))
}

function buildErrorDebug(details: string[], rawDetail?: string): ManagedRuntimeErrorDebug | undefined {
  const url = firstUrl(details)
  const host = urlHost(url) || firstHost(details)
  const ip = firstIp(details)
  const debug = { rawDetail: rawDetail || preferredDetail(details), url, host, ip }
  return Object.values(debug).some(Boolean) ? debug : undefined
}

function readErrorDebug(error: unknown): ManagedRuntimeErrorDebug | undefined {
  if (!error || typeof error !== 'object' || !('debug' in error)) return undefined
  const value = (error as ErrorLike).debug
  if (!value || typeof value !== 'object') return undefined
  const debug = { rawDetail: readString((value as ErrorLike).rawDetail), url: readString((value as ErrorLike).url), host: readString((value as ErrorLike).host), ip: readString((value as ErrorLike).ip) }
  return Object.values(debug).some(Boolean) ? debug : undefined
}

function readOwnershipConflict(error: unknown): OwnershipConflict | undefined {
  if (!error || typeof error !== 'object' || !('ownershipConflict' in error)) return undefined
  const value = (error as ErrorLike).ownershipConflict
  if (!value || typeof value !== 'object') return undefined
  const pid = readNumber((value as ErrorLike).pid)
  const port = readNumber((value as ErrorLike).port)
  if (pid === undefined || port === undefined) return undefined
  return { pid, port, summary: readString((value as ErrorLike).summary), stopCommand: readString((value as ErrorLike).stopCommand) }
}

function firstUrl(details: string[]): string | undefined {
  return details.join(' ').match(/https?:\/\/[^\s'"`]+/)?.[0]
}

function urlHost(url: string | undefined): string | undefined {
  if (!url) return undefined
  try { return new URL(url).hostname } catch { return undefined }
}

function firstHost(details: string[]): string | undefined {
  return details.join(' ').match(/(?:lookup|host)\s+([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]
}

function firstIp(details: string[]): string | undefined {
  return details.join(' ').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0]
}

function preferredDetail(details: string[]): string | undefined {
  return details.map((detail) => detail.trim()).find((detail) => detail && !isGenericDetail(detail)) || firstDetail(details)
}

function firstDetail(details: string[]): string | undefined {
  return details.map((detail) => detail.trim()).find(Boolean)
}

function isGenericDetail(detail: string): boolean {
  const value = detail.trim().toLowerCase()
  return value === 'error' || value === 'typeerror' || value === 'fetch failed' || /^[a-z_]+(?:error)?$/.test(value)
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
