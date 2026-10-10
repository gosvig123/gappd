import { createHash } from 'node:crypto'
import type { AgendaCommunication, CommunicationSource } from './agenda-communication'
import { meetingCommunicationPeriod } from './agenda-communication'
import { requestCommand } from './app-protocol'
import { createSecureStore } from './electron-secure-store'
import { googleAgendaCommunication, googleCalendarSnapshot } from './google-calendar-service'
import { participantContext } from './participant-calendar'
import { slackAgendaCommunication } from './slack-service'
import { usingSummaryRuntime } from './summary-runtime'
import { inviteeEmails } from '../shared/meeting-agenda'
import { enrichmentEvent, type EnrichmentStatus, type MeetingEnrichment } from '../shared/meeting-enrichment'

const STORE_FILE = 'meeting-enrichment.enc'
const MAX_MESSAGES_PER_SERVICE = 16
type Stored = Omit<MeetingEnrichment, 'stale'> & { summaryDigest: string }
type EnrichmentDocument = { version: 1; meetings: Record<string, Stored> }
let queue: Promise<unknown> = Promise.resolve()

/**
 * Reads Gmail and existing Slack DMs with the Meeting's Calendar invitees, from 30 days before
 * until 7 days after the Meeting, and asks the AI provider for context on existing action items.
 * It never sends messages and never changes the Meeting or its summary.
 */
export async function enrichMeeting(id: string): Promise<MeetingEnrichment> {
  const { meeting } = await requestCommand('meetings.show', { id })
  if (!meeting.summary) throw new Error('Add Gmail and Slack context: this Meeting has no notes yet. Wait for notes, then try again.')
  // Checked before any message is read; the backend makes the exact per-line check.
  if (!/^#{1,6}\s+action items:?\s*$/im.test(meeting.summary)) throw new Error('Add Gmail and Slack context: these notes have no action items, so there is nothing to add context to.')
  const event = enrichmentEvent(await participantContext(id))
  const snapshot = await googleCalendarSnapshot()
  const emails = inviteeEmails(event, snapshot.connections.map(connection => connection.email))
  if (!emails.length) throw new Error('Add Gmail and Slack context: the Calendar event has no other invitees to read messages with.')
  const period = meetingCommunicationPeriod(meeting.startedAt, meeting.endedAt)
  const gmail = await googleAgendaCommunication(event.connectionId, emails, period)
  const slack = await slackAgendaCommunication(emails, [], period)
  const warnings = [gmail.warning, slack.warning].filter((value): value is string => Boolean(value))
  const communication = [gmail, slack].flatMap(result => newestMessages(result, warnings))
  let notes: MeetingEnrichment['notes'] = []
  let generation: MeetingEnrichment['generation']
  if (communication.length) {
    const result = await usingSummaryRuntime(() => {
      gmail.assertCurrent?.()
      slack.assertCurrent?.()
      return requestCommand('meetings.enrich', { id, communicationInput: '-' }, {}, AbortSignal.timeout(20 * 60 * 1000 + 5000), JSON.stringify(communication))
    })
    notes = result.notes.map(note => ({ ...note, status: note.status as EnrichmentStatus }))
    generation = result.generation
    if (result.trimmed) warnings.push('Long messages were read only up to their first 3000 bytes.')
  } else {
    warnings.push('No Gmail or Slack messages with the invitees were found from 30 days before to 7 days after this Meeting.')
  }
  const cited = new Set(notes.map(note => note.sourceId))
  const stored: Stored = {
    meetingId: id,
    generatedAt: new Date().toISOString(),
    eventTitle: event.title,
    messageCount: communication.length,
    notes,
    sources: communication.filter(source => cited.has(source.id)).map(({ text: _text, ...source }) => source),
    warning: warnings.join(' ') || undefined,
    generation,
    summaryDigest: summaryDigest(meeting.summary),
  }
  await serialize(async () => {
    const document = await readDocument()
    document.meetings[id] = stored
    await createSecureStore<EnrichmentDocument>(STORE_FILE).write(document)
  })
  return view(stored, meeting.summary)
}

export async function loadMeetingEnrichment(id: string): Promise<MeetingEnrichment | null> {
  const stored = await serialize(async () => (await readDocument()).meetings[id])
  if (!stored) return null
  const { meeting } = await requestCommand('meetings.show', { id })
  return view(stored, meeting.summary ?? '')
}

export function forgetMeetingEnrichment(id: string): Promise<void> {
  return serialize(async () => {
    const document = await readDocument()
    if (!document.meetings[id]) return
    delete document.meetings[id]
    await createSecureStore<EnrichmentDocument>(STORE_FILE).write(document)
  })
}

function newestMessages(result: AgendaCommunication, warnings: string[]): CommunicationSource[] {
  if (result.sources.length > MAX_MESSAGES_PER_SERVICE) warnings.push(`Context includes only the ${MAX_MESSAGES_PER_SERVICE} newest messages from each communication service.`)
  return [...result.sources].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MAX_MESSAGES_PER_SERVICE)
}

function view({ summaryDigest: digest, ...stored }: Stored, summary: string): MeetingEnrichment {
  return { ...stored, stale: digest !== summaryDigest(summary) }
}

function summaryDigest(summary: string): string {
  return createHash('sha256').update(summary).digest('hex')
}

async function readDocument(): Promise<EnrichmentDocument> {
  const value = await createSecureStore<EnrichmentDocument>(STORE_FILE).read()
  // Stored context is derived and can be made again, so unreadable data starts empty.
  if (!value || value.version !== 1 || !value.meetings || typeof value.meetings !== 'object') return { version: 1, meetings: {} }
  return value
}

function serialize<T>(action: () => Promise<T>): Promise<T> {
  const operation = queue.then(action)
  queue = operation.catch(() => undefined)
  return operation
}
