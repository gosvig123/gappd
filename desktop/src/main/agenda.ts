import { requestCommand } from './app-protocol'
import { createSecureStore } from './electron-secure-store'
import { googleCalendarSnapshot } from './google/calendar-service'
import { createObservableState } from './observable-state'
import { savedMeetingCalendarContexts } from './participant-calendar'
import { getStartupSettings } from './startup-settings'
import { usingSummaryRuntime } from './summary-runtime'
import { calendarEventKey, type CalendarEventSummary } from '../shared/calendar-contract'
import { agendaDueEvents, agendaRequest, cleanAgendaItems, draftedAgenda, type Agenda } from '../shared/agenda'

// Agendas belong to Calendar events, so they are kept encrypted like the Calendar links of Meetings.
const STORE_FILE = 'meeting-agendas.enc'
const TICK_MS = 60_000
type AgendaStore = { version: 1; agendas: Record<string, Agenda> }

const changes = createObservableState<Record<string, Agenda>>({})
const drafting = new Map<string, Promise<Agenda>>()
const controllers = new Set<AbortController>()
const deletedMeetingIds = new Set<string>()
// Automatic drafting tries each event once per app run; Prepare agenda can always try again.
const attempted = new Set<string>()
let queue: Promise<unknown> = Promise.resolve()
let timer: NodeJS.Timeout | null = null
let checking = false

export function listAgendas(): Promise<Record<string, Agenda>> {
  return serialize(async () => (await readStore()).agendas)
}

export function onAgendasChange(listener: (agendas: Record<string, Agenda>) => void): () => void {
  return changes.subscribe(listener)
}

/** Drafts the Agenda of one Calendar event from its Related Meetings and saves it in place of the current one. */
export function draftAgenda(eventKey: string): Promise<Agenda> {
  const running = drafting.get(eventKey)
  if (running) return running
  const controller = new AbortController()
  controllers.add(controller)
  const work = draft(eventKey, controller.signal).finally(() => {
    drafting.delete(eventKey)
    controllers.delete(controller)
  })
  drafting.set(eventKey, work)
  return work
}

async function draft(eventKey: string, signal: AbortSignal): Promise<Agenda> {
  const snapshot = await googleCalendarSnapshot()
  const event = findEvent(snapshot.events, eventKey)
  const request = agendaRequest(event, await savedMeetingCalendarContexts(), snapshot.connections.map((connection) => connection.email))
  const updatedAt = (await listAgendas())[eventKey]?.updatedAt
  signal.throwIfAborted()
  const response = await usingSummaryRuntime((env) => requestCommand('meetings.agenda', request, env, signal))
  const agenda = draftedAgenda(eventKey, event, response)
  return serialize(async () => {
    const store = await readStore()
    signal.throwIfAborted()
    if (store.agendas[eventKey]?.updatedAt !== updatedAt) throw new Error('Draft agenda: the agenda changed while drafting, so your changes were kept. Choose Draft again to replace them.')
    removeAgendaMeetings(agenda, deletedMeetingIds)
    store.agendas[eventKey] = agenda
    await writeStore(store)
    return agenda
  })
}

/** Saves the user's items. An event without an Agenda gets one with only these items. */
export async function saveAgendaItems(eventKey: string, items: unknown): Promise<Agenda> {
  const existing = (await listAgendas())[eventKey]
  const event = existing ? null : findEvent((await googleCalendarSnapshot()).events, eventKey)
  return serialize(async () => {
    const store = await readStore()
    const now = new Date().toISOString()
    const current = store.agendas[eventKey] ?? (event ? { eventKey, title: event.title, start: event.start, items: [], sources: [], draftedAt: '', updatedAt: now, edited: false } : null)
    if (!current) throw new Error('Save agenda: the Calendar event is no longer available. Refresh Calendar and open the event again.')
    const agenda = { ...current, items: cleanAgendaItems(items, current.sources), updatedAt: now, edited: true }
    store.agendas[eventKey] = agenda
    await writeStore(store)
    return agenda
  })
}

export function startAgendaAutoDraft(): void {
  if (timer) return
  timer = setInterval(() => void draftDueAgendas().catch((error) => console.error('Automatic agenda drafting failed; it will retry on the next check', error)), TICK_MS)
}

export function stopAgendaAutoDraft(): void {
  if (timer) clearInterval(timer)
  timer = null
  for (const controller of controllers) controller.abort()
}

async function draftDueAgendas(): Promise<void> {
  if (checking || !getStartupSettings().agendaAutoDraftEnabled) return
  checking = true
  try {
    const saved = await listAgendas()
    const due = agendaDueEvents((await googleCalendarSnapshot()).events, (event) => {
      const key = calendarEventKey(event)
      return Boolean(saved[key]) || attempted.has(key)
    })
    for (const event of due) {
      if (!timer || !getStartupSettings().agendaAutoDraftEnabled) return
      const key = calendarEventKey(event)
      const events = (await googleCalendarSnapshot()).events.filter((item) => calendarEventKey(item) === key)
      const current = await listAgendas()
      if (!timer || !getStartupSettings().agendaAutoDraftEnabled) return
      if (!agendaDueEvents(events, () => Boolean(current[key]) || attempted.has(key)).length) continue
      attempted.add(key)
      try { await draftAgenda(key) }
      catch (error) { console.error(`Draft agenda for "${event.title}" automatically: skipped; Prepare agenda remains available.`, error) }
    }
  } finally { checking = false }
}

/** Removes a deleted Meeting's source links while keeping the Agenda items. */
export function forgetAgendaMeeting(id: string): Promise<void> {
  deletedMeetingIds.add(id)
  return serialize(async () => {
    const store = await readStore()
    let changed = false
    for (const agenda of Object.values(store.agendas)) {
      if (!removeAgendaMeetings(agenda, deletedMeetingIds)) continue
      agenda.updatedAt = new Date().toISOString()
      changed = true
    }
    if (changed) await writeStore(store)
  })
}

/** Removes source links for deleted Meetings without changing item text. */
function removeAgendaMeetings(agenda: Agenda, ids: Set<string>): boolean {
  const refs = new Set(agenda.sources.filter((source) => ids.has(source.id)).map((source) => source.ref))
  if (!refs.size) return false
  agenda.sources = agenda.sources.filter((source) => !ids.has(source.id))
  agenda.items = agenda.items.map((item) => ({ ...item, sources: item.sources.filter((ref) => !refs.has(ref)) }))
  return true
}

function findEvent(events: CalendarEventSummary[], eventKey: string): CalendarEventSummary {
  const event = events.find((item) => calendarEventKey(item) === eventKey)
  if (!event) throw new Error('Draft agenda: the Calendar event is no longer available. Refresh Calendar and open the event again.')
  return event
}

async function readStore(): Promise<AgendaStore> {
  const value = await createSecureStore<AgendaStore>(STORE_FILE).read()
  if (!value) return { version: 1, agendas: {} }
  if (value.version !== 1 || !value.agendas || typeof value.agendas !== 'object') throw new Error('Read agendas: invalid local data. Restore the agenda store from backup.')
  return value
}

async function writeStore(store: AgendaStore): Promise<void> {
  await createSecureStore<AgendaStore>(STORE_FILE).write(store)
  changes.set({ ...store.agendas })
}

function serialize<T>(action: () => Promise<T>): Promise<T> {
  const operation = queue.then(action)
  queue = operation.catch(() => undefined)
  return operation
}
