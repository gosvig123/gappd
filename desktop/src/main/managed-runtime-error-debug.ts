import type { ManagedRuntimeErrorDebug, OwnershipConflict } from '../shared/contracts'

type ErrorLike = Record<string, unknown>

export function buildErrorDebug(details: string[], rawDetail?: string): ManagedRuntimeErrorDebug | undefined {
  const url = firstUrl(details)
  const host = urlHost(url) || firstHost(details)
  const ip = firstIp(details)
  const debug = { rawDetail: rawDetail || preferredDetail(details), url, host, ip }
  return Object.values(debug).some(Boolean) ? debug : undefined
}

export function readErrorDebug(error: unknown): ManagedRuntimeErrorDebug | undefined {
  if (!error || typeof error !== 'object' || !('debug' in error)) return undefined
  const value = (error as ErrorLike).debug
  if (!value || typeof value !== 'object') return undefined
  const debug = { rawDetail: readString((value as ErrorLike).rawDetail), url: readString((value as ErrorLike).url), host: readString((value as ErrorLike).host), ip: readString((value as ErrorLike).ip) }
  return Object.values(debug).some(Boolean) ? debug : undefined
}

export function readOwnershipConflict(error: unknown): OwnershipConflict | undefined {
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
