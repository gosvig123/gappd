import { reconcileAgendaHistory, agendaReconciliationStatus, agendaCalendarSyncIds, agendaHistoryWarning } from '../shared/calendar-reconciliation'
import type { CalendarEventSummary, CalendarSnapshot } from '../shared/calendar-contract'
import type { GeneratedAgenda } from '../shared/agenda-draft'
import type { AgendaHistory, MeetingAgendaDraft } from '../shared/meeting-agenda'
import { calendarEventIsUpcoming, inviteeEmails, matchAgendaHistory } from '../shared/meeting-agenda'
import { persistGeneratedAgenda } from './agenda-drafts'
import { requestCommand } from './app-protocol'
import { googleCalendarSnapshot, googleCalendarPendingSyncIds, syncGoogleCalendar } from './google-calendar-service'
import { savedMeetingCalendarContexts } from './participant-calendar'
import { usingSummaryRuntime } from './summary-runtime'

export async function generateMeetingAgenda(input: { sourceId: string; expectedRevision: number }): Promise<GeneratedAgenda> {
  const { snapshot, history } = await prepareAgendaHistory(input.sourceId)
  const event = snapshot.events.find(event => event.sourceId === input.sourceId)
  if (!event || !calendarEventIsUpcoming(event)) throw new Error('This Calendar event is no longer upcoming. Refresh Calendar.')
  const selfEmails = snapshot.connections.map(connection => connection.email)
  const result = await generateAgendaDraft(event, history, snapshot, selfEmails)
  return persistGeneratedAgenda({ event, draft: result.draft, generation: result.generation, expectedRevision: input.expectedRevision })
}

async function generateAgendaDraft(event: CalendarEventSummary, history: AgendaHistory[], snapshot: CalendarSnapshot, selfEmails: string[]): Promise<{ draft: MeetingAgendaDraft; generation?: { model?: string; reasoningEffort?: string } }> {
  const reconciliation = { ...agendaReconciliationStatus(history), historyWarning: agendaHistoryWarning(history, snapshot) }
  if (!inviteeEmails(event, selfEmails).length) return { draft: { items: [], sources: [] } }
  const sources = matchAgendaHistory(event, history, selfEmails)
  if (!sources.length) return { draft: { items: [], sources: [], ...reconciliation } }
  const result = await usingSummaryRuntime(() => requestCommand('meetings.agenda', { title: event.title, meetingIds: sources.map(source => source.id).join(',') }, {}, AbortSignal.timeout(20 * 60 * 1000 + 5000)))
  return { draft: { items: result.items, sources, ...reconciliation }, generation: result.generation }
}

async function prepareAgendaHistory(sourceId: string): Promise<{ snapshot: CalendarSnapshot; history: AgendaHistory[] }> {
  // Snapshot waits for active syncs. Do not retry those attempts during this generation.
  const attempted = new Set(googleCalendarPendingSyncIds())
  let snapshot = await googleCalendarSnapshot()
  const event = snapshot.events.find(event => event.sourceId === sourceId)
  if (!event || !calendarEventIsUpcoming(event)) throw new Error('This Calendar event is no longer upcoming. Refresh Calendar.')
  if (!inviteeEmails(event, snapshot.connections.map(connection => connection.email)).length) return { snapshot, history: [] }
  let data = await readAgendaHistory()
  const ids = agendaCalendarSyncIds(data.history.meetings, data.contexts, snapshot).filter(id => !attempted.has(id))
  if (ids.length) {
    // The service coalesces account requests and bounds network requests/pages/history ranges.
    await Promise.allSettled(ids.map(id => syncGoogleCalendar(id)))
  }
  if (ids.length || attempted.size) {
    snapshot = await googleCalendarSnapshot()
    data = await readAgendaHistory()
  }
  return { snapshot, history: reconcileAgendaHistory(data.history.meetings, data.contexts, snapshot) }
}

async function readAgendaHistory() {
  const [history, contexts] = await Promise.all([requestCommand('meetings.agendaHistory', {}), savedMeetingCalendarContexts()])
  return { history, contexts }
}
