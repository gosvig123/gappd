/** Durable one-way upload queue for owned cloud Meeting copies. */

export const MEETING_SYNC_VERSION = 1
export const MAX_SYNC_ATTEMPTS = 5

export type MeetingSyncState = 'pending' | 'failed'

export type MeetingSyncEntry = {
  localId: string
  revision: number
  state: MeetingSyncState
  attempts: number
  updatedAt: string
  error: string | null
}

export type MeetingSyncStatus = {
  pending: number
  failed: number
  entries: MeetingSyncEntry[]
}

/** One unit of upload work: the exact bytes accepted at enqueue time. */
export type MeetingSyncWork = MeetingSyncEntry & { document: string }

export type MeetingSyncDocument = {
  version: number
  /** The account that owns this queue. Null means no account has used this Mac yet. */
  subject: string | null
  /** Highest revision accepted by the server for each local Meeting. */
  accepted: Record<string, number>
  /** Pending work, newest revision per local Meeting. */
  entries: Record<string, { revision: number; document: string; state: MeetingSyncState; attempts: number; updatedAt: string; error: string | null }>
}

export function emptyMeetingSyncDocument(): MeetingSyncDocument {
  return { version: MEETING_SYNC_VERSION, subject: null, accepted: {}, entries: {} }
}

/**
 * Accepts a stored document only when every field has the expected shape. A damaged or
 * unsupported file is refused whole, because silently dropping queued work would lose
 * uploads without saying so.
 */
export function validatedMeetingSyncDocument(stored: unknown): MeetingSyncDocument | null {
  if (!stored || typeof stored !== 'object') return null
  const candidate = stored as Partial<MeetingSyncDocument>
  if (candidate.version !== MEETING_SYNC_VERSION || !candidate.accepted || !candidate.entries) return null
  // A document written before the queue belonged to an account has no subject and is adopted
  // by the first account that claims it.
  if (candidate.subject !== undefined && !(candidate.subject === null || (typeof candidate.subject === 'string' && candidate.subject.length > 0 && candidate.subject.length <= 320))) return null
  const accepted: Record<string, number> = {}
  for (const [localId, revision] of Object.entries(candidate.accepted)) {
    if (!revisionOf(revision)) return null
    accepted[localId] = revision
  }
  const entries: MeetingSyncDocument['entries'] = {}
  for (const [localId, entry] of Object.entries(candidate.entries)) {
    if (!validEntry(entry)) return null
    entries[localId] = entry
  }
  return { version: MEETING_SYNC_VERSION, subject: candidate.subject ?? null, accepted, entries }
}

function revisionOf(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function validEntry(entry: unknown): entry is MeetingSyncDocument['entries'][string] {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as MeetingSyncDocument['entries'][string]
  return revisionOf(candidate.revision) && typeof candidate.document === 'string' && candidate.document.length > 0 &&
    (candidate.state === 'pending' || candidate.state === 'failed') && Number.isInteger(candidate.attempts) &&
    candidate.attempts >= 0 && typeof candidate.updatedAt === 'string' &&
    (candidate.error === null || typeof candidate.error === 'string')
}
