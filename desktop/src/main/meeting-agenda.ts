import { reconcileAgendaHistory, agendaReconciliationStatus, agendaCalendarSyncIds, agendaHistoryWarning } from '../shared/calendar-reconciliation'
import type { CalendarEventSummary, CalendarSnapshot } from '../shared/calendar-contract'
import type { GeneratedAgenda } from '../shared/agenda-draft'
import type { AgendaHistory, MeetingAgendaDraft } from '../shared/meeting-agenda'
import { calendarEventIsUpcoming, inviteeEmails, matchAgendaHistory } from '../shared/meeting-agenda'
import { persistGeneratedAgenda } from './agenda-drafts'
import { requestCommand } from './app-protocol'
import { googleCalendarSnapshot, googleCalendarPendingSyncIds, syncGoogleCalendar, googleAgendaCommunication } from './google-calendar-service'
import { slackAgendaCommunication } from './slack-service'
import { agendaSlackChannels } from './slack-agenda'
import type { GenerateAgendaInput } from '../shared/ipc-contract'
import { savedMeetingCalendarContexts } from './participant-calendar'
import { usingSummaryRuntime } from './summary-runtime'

export async function generateMeetingAgenda(input: GenerateAgendaInput): Promise<GeneratedAgenda> {
  const channels = agendaSlackChannels(input.slackChannelIds)
  const { snapshot, history } = await prepareAgendaHistory(input.sourceId)
  const event = snapshot.events.find(event => event.sourceId === input.sourceId)
  if (!event || !calendarEventIsUpcoming(event)) throw new Error('This Calendar event is no longer upcoming. Refresh Calendar.')
  const selfEmails = snapshot.connections.map(connection => connection.email)
  const result = await generateAgendaDraft(event, history, snapshot, selfEmails, channels)
  return persistGeneratedAgenda({ event, draft: result.draft, generation: result.generation, expectedRevision: input.expectedRevision })
}

async function generateAgendaDraft(event: CalendarEventSummary, history: AgendaHistory[], snapshot: CalendarSnapshot, selfEmails: string[], channels: string[]): Promise<{ draft: MeetingAgendaDraft; generation?: { model?: string; reasoningEffort?: string } }> {
  const reconciliation = { ...agendaReconciliationStatus(history), historyWarning: agendaHistoryWarning(history, snapshot) }
  const emails = inviteeEmails(event, selfEmails)
  if (!emails.length && !channels.length) return { draft: { items: [], sources: [] } }
  const meetings = matchAgendaHistory(event, history, selfEmails)
  const before = Math.min(Date.parse(event.start), Date.now())
  const gmail = emails.length ? await googleAgendaCommunication(event.connectionId, emails, before) : { sources: [] }
  const slack = await slackAgendaCommunication(emails, channels, before)
  const warnings = [gmail.warning, slack.warning].filter(Boolean)
  const communication = [gmail, slack].flatMap(result => {
    if (result.sources.length > 16) warnings.push('Agenda context includes only the 16 newest messages from each communication service. Confirm current status before use.')
    return result.sources.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 16)
  })
  const sources = [...meetings, ...communication.map(({ text: _text, ...source }) => source)]
  const communicationWarning = warnings.join(' ') || undefined
  if (!sources.length) return { draft: { items: [], sources: [], ...reconciliation, communicationWarning } }
  const result = await usingSummaryRuntime(() => {
    gmail.assertCurrent?.()
    slack.assertCurrent?.()
    return requestCommand('meetings.agenda', { title: event.title, meetingIds: meetings.map(source => source.id).join(','), communicationInput: '-' }, {}, AbortSignal.timeout(20 * 60 * 1000 + 5000), JSON.stringify(communication))
  })
  return { draft: { items: result.items, sources, ...reconciliation, communicationWarning }, generation: result.generation }
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
