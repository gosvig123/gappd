import { reconcileAgendaHistory, agendaReconciliationStatus, agendaCalendarSyncIds, agendaHistoryWarning } from '../shared/calendar-reconciliation'
import type { CalendarSnapshot } from '../shared/calendar-contract'
import type { AgendaHistory, MeetingAgendaDraft } from '../shared/meeting-agenda'
import { calendarEventIsUpcoming, inviteeEmails, matchAgendaHistory } from '../shared/meeting-agenda'
import { requestCommand } from './app-protocol'
import { googleCalendarSnapshot, googleCalendarPendingSyncIds, syncGoogleCalendar } from './google-calendar-service'
import { savedMeetingCalendarContexts } from './participant-calendar'
import { usingSummaryRuntime } from './summary-runtime'

export async function generateMeetingAgenda(sourceId: string): Promise<MeetingAgendaDraft> {
  const { snapshot, history } = await prepareAgendaHistory(sourceId)
  const event = snapshot.events.find(event => event.sourceId === sourceId)
  if (!event || !calendarEventIsUpcoming(event)) throw new Error('This Calendar event is no longer upcoming. Refresh Calendar.')
  const selfEmails = snapshot.connections.map(connection => connection.email)
  if (!inviteeEmails(event, selfEmails).length) return { items: [], sources: [] }
  const reconciliation = { ...agendaReconciliationStatus(history), historyWarning: agendaHistoryWarning(history, snapshot) }
  const sources = matchAgendaHistory(event, history, selfEmails)
  if (!sources.length) return { items: [], sources: [], ...reconciliation }
  const result = await usingSummaryRuntime(() => requestCommand('meetings.agenda', { title: event.title, meetingIds: sources.map(source => source.id).join(',') }, {}, AbortSignal.timeout(20 * 60 * 1000 + 5000)))
  return { items: result.items, sources, ...reconciliation }
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
