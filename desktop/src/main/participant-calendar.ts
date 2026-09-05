import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { LinkCalendarInput, ParticipantContext } from '../shared/participant-contract'
import { requestCommand } from './app-protocol'
import { createSecureStore } from './electron-secure-store'
import { googleCalendarSnapshot } from './google-calendar-service'

const STORE_FILE = 'meeting-calendar.enc'
const EVENT_MARGIN_MS = 15 * 60 * 1000
type CalendarLinks = { version: 1; meetings: Record<string, ParticipantContext> }
let queue: Promise<unknown> = Promise.resolve()

export async function participantContext(id: string): Promise<ParticipantContext> {
  return serialize(async () => {
    const { meeting } = await requestCommand('meetings.show', { id })
    const { events } = await googleCalendarSnapshot()
    const document = await readLinks()
    const saved = document.meetings[id]
    const context = mergeContext(saved, calendarCandidates(events, meeting.startedAt, meeting.endedAt, saved))
    if (context.event || context.candidates.length) await saveContext(document, id, context)
    return context
  })
}

function mergeContext(saved: ParticipantContext | undefined, current: ParticipantContext): ParticipantContext {
  const candidates = new Map((saved?.candidates ?? []).map((event) => [event.sourceId, event]))
  for (const event of current.candidates) candidates.set(event.sourceId, event)
  const event = saved?.event && (candidates.get(saved.event.sourceId) ?? saved.event)
  return { event, candidates: [...candidates.values()] }
}

export async function linkCalendar(input: LinkCalendarInput): Promise<ParticipantContext> {
  const context = await participantContext(input.id)
  const event = context.candidates.find((candidate) => candidate.sourceId === input.eventSourceId)
  if (input.eventSourceId && !event) throw new Error('Link calendar event: event unavailable. Refresh the meeting and choose a suggested event.')
  return serialize(async () => {
    await requestCommand('meetings.show', { id: input.id })
    const updated = { ...context, event }
    await saveContext(await readLinks(), input.id, updated)
    return updated
  })
}

export async function recordingCalendarContext(eventSourceId?: string): Promise<ParticipantContext> {
  const { events } = await googleCalendarSnapshot()
  const context = calendarCandidates(events, new Date().toISOString())
  if (!eventSourceId) return context
  const event = events.find((candidate) => candidate.sourceId === eventSourceId)
  if (!event) throw new Error('Start calendar recording: event unavailable. Refresh Calendar and select the event again.')
  return { event, candidates: context.candidates.some((item) => item.sourceId === eventSourceId) ? context.candidates : [event, ...context.candidates] }
}

export function rememberRecordingCalendar(id: string, context: ParticipantContext): Promise<void> {
  if (!context.event && !context.candidates.length) return Promise.resolve()
  return serialize(async () => {
    await requestCommand('meetings.show', { id })
    await saveContext(await readLinks(), id, context)
  })
}

export function forgetMeetingCalendar(id: string): Promise<void> {
  return serialize(async () => {
    const document = await readLinks()
    delete document.meetings[id]
    await createSecureStore<CalendarLinks>(STORE_FILE).write(document)
  })
}

function calendarCandidates(events: CalendarEventSummary[], startedAt: string, endedAt?: string, saved?: ParticipantContext): ParticipantContext {
  const start = Date.parse(startedAt)
  const end = endedAt ? Date.parse(endedAt) : start
  const retained = new Set(saved?.candidates.map((event) => event.sourceId))
  if (saved?.event) retained.add(saved.event.sourceId)
  const candidates = events.filter((event) => retained.has(event.sourceId) || !event.allDay && Date.parse(event.start) <= end + EVENT_MARGIN_MS && Date.parse(event.end) >= start - EVENT_MARGIN_MS)
  return { candidates }
}

async function readLinks(): Promise<CalendarLinks> {
  const value = await createSecureStore<CalendarLinks>(STORE_FILE).read()
  if (!value) return { version: 1, meetings: {} }
  if (value.version !== 1 || !value.meetings || typeof value.meetings !== 'object') throw new Error('Read meeting calendar links: invalid local data. Restore the calendar store from backup.')
  return value
}

async function saveContext(document: CalendarLinks, id: string, context: ParticipantContext): Promise<void> {
  document.meetings[id] = context
  await createSecureStore<CalendarLinks>(STORE_FILE).write(document)
}

function serialize<T>(action: () => Promise<T>): Promise<T> {
  const operation = queue.then(action)
  queue = operation.catch(() => undefined)
  return operation
}
