import { reconcileAgendaHistory, agendaReconciliationStatus } from '../shared/calendar-reconciliation'
import type { CalendarSnapshot } from '../shared/calendar-contract'
import type { AgendaHistory, MeetingAgendaDraft } from '../shared/meeting-agenda'
import { calendarEventIsUpcoming, inviteeEmails, matchAgendaHistory } from '../shared/meeting-agenda'
import { requestCommand } from './app-protocol'
import { googleCalendarSnapshot } from './google-calendar-service'
import { savedMeetingCalendarContexts } from './participant-calendar'
import { usingSummaryRuntime } from './summary-runtime'

export async function generateMeetingAgenda(sourceId: string): Promise<MeetingAgendaDraft> {
  const snapshot = await googleCalendarSnapshot()
  const event = snapshot.events.find(event => event.sourceId === sourceId)
  if (!event || !calendarEventIsUpcoming(event)) throw new Error('This Calendar event is no longer upcoming. Refresh Calendar.')
  const selfEmails = snapshot.connections.map(connection => connection.email)
  if (!inviteeEmails(event, selfEmails).length) return { items: [], sources: [] }
  const history = await agendaHistory(snapshot)
  const reconciliation = agendaReconciliationStatus(history)
  const sources = matchAgendaHistory(event, history, selfEmails)
  if (!sources.length) return { items: [], sources: [], ...reconciliation }
  const result = await usingSummaryRuntime(() => requestCommand('meetings.agenda', { title: event.title, meetingIds: sources.map(source => source.id).join(',') }))
  return { items: result.items, sources, ...reconciliation }
}

async function agendaHistory(snapshot: CalendarSnapshot): Promise<AgendaHistory[]> {
  const [history, contexts] = await Promise.all([requestCommand('meetings.agendaHistory', {}), savedMeetingCalendarContexts()])
  return reconcileAgendaHistory(history.meetings, contexts, snapshot)
}
