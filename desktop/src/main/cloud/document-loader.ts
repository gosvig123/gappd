import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { genericMeetingTitle } from '../../shared/meeting-title.ts'

/** The cloud rejects a document above 2 MiB, so refuse one locally before reading it. */
export const MAX_DOCUMENT_BYTES = 2 << 20
const DOCUMENT_TIMEOUT_MS = 15_000
const LOCAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAMP_PATTERN = /^[a-f0-9]{64}$/

export type LoadedMeetingDocument = { document: string; stamp?: string }
export type CalendarTitleLookup = (localId: string, startedAt?: string, endedAt?: string) => Promise<string[]>

/**
 * Builds the version-1 document for one local Meeting by running the app's own CLI. The
 * revision is passed in, because the sync queue owns it and the document carries it. Invalid
 * input never starts a process. `calendarTitles` returns the titles of the Calendar events saved
 * for the Meeting.
 */
export function meetingDocumentLoader(binary: () => string, calendarTitles: CalendarTitleLookup = async () => []) {
  return async (localId: string, revision: number): Promise<string> => {
    validateArgs(localId, revision)
    const document = await runExport(binary, ['meeting-document', 'export', localId, String(revision)])
    if (document.length === 0 || document.length > MAX_DOCUMENT_BYTES) throw new Error('Meeting document unavailable.')
    return maskDocument(document, calendarTitles, localId).then((result) => result.document)
  }
}

/**
 * Exports one Meeting together with the exact source stamp of that snapshot (including whether
 * its Calendar title was masked), so the sync queue never caches a stamp from a separate read.
 */
export function meetingDocumentWithStampLoader(binary: () => string, calendarTitles: CalendarTitleLookup = async () => []) {
  return async (localId: string, revision: number): Promise<LoadedMeetingDocument> => {
    validateArgs(localId, revision)
    const raw = await runExport(binary, ['meeting-document', 'export', localId, String(revision), '--with-stamp'])
    const parsed = parseEnvelope(raw)
    if (parsed.document.length === 0 || parsed.document.length > MAX_DOCUMENT_BYTES) throw new Error('Meeting document unavailable.')
    const { document, masked } = await maskDocument(parsed.document, calendarTitles, localId)
    return { document, stamp: foldCalendarMaskStamp(parsed.stamp, masked) }
  }
}

export function foldCalendarMaskStamp(stamp: string, masked: boolean): string {
  if (!masked) return stamp
  return createHash('sha256').update(`${stamp}:calendar-masked`).digest('hex')
}

function validateArgs(localId: string, revision: number): void {
  if (!LOCAL_ID.test(localId) || !Number.isInteger(revision) || revision < 1) {
    throw new Error('Meeting document unavailable.')
  }
}

function runExport(binary: () => string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(binary(), args, {
      env: process.env, timeout: DOCUMENT_TIMEOUT_MS, maxBuffer: MAX_DOCUMENT_BYTES + 8192, encoding: 'utf8',
    }, (error, stdout) => error ? reject(new Error('Meeting document unavailable.')) : resolve(stdout))
  })
}

function parseEnvelope(raw: string): { stamp: string; document: string } {
  try {
    const parsed = JSON.parse(raw) as { stamp?: unknown; document?: unknown }
    if (typeof parsed.stamp !== 'string' || !STAMP_PATTERN.test(parsed.stamp) || !parsed.document || typeof parsed.document !== 'object') {
      throw new Error('invalid envelope')
    }
    return { stamp: parsed.stamp, document: JSON.stringify(parsed.document) }
  } catch {
    throw new Error('Meeting document unavailable.')
  }
}

/**
 * A Calendar event title is Google data, and AI clients read cloud copies, so a Meeting that is
 * still named after its Calendar event uploads a generic title.
 */
async function maskDocument(document: string, calendarTitles: CalendarTitleLookup, localId: string): Promise<{ document: string; masked: boolean }> {
  let startedAt: string | undefined
  let endedAt: string | undefined
  let parsed: { title?: unknown; started_at?: unknown; ended_at?: unknown } | null = null
  try {
    parsed = JSON.parse(document) as { title?: unknown; started_at?: unknown; ended_at?: unknown }
    if (typeof parsed.started_at === 'string') startedAt = parsed.started_at
    if (typeof parsed.ended_at === 'string') endedAt = parsed.ended_at
  } catch { /* Handled below if calendar titles are present. */ }
  const titles = new Set((await calendarTitles(localId, startedAt, endedAt)).map((title) => title.trim()))
  if (!titles.size || !parsed) return { document, masked: false }
  if (typeof parsed.title !== 'string' || !titles.has(parsed.title.trim()) || typeof parsed.started_at !== 'string') {
    return { document, masked: false }
  }
  return { document: JSON.stringify({ ...parsed, title: genericMeetingTitle(new Date(parsed.started_at)) }), masked: true }
}
