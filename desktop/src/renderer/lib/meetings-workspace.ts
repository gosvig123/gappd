import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
import type { SavedAgendaDraft } from '../../shared/agenda-draft'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { agendaDraftKey } from '../../shared/agenda-draft.ts'

export type AgendaTarget = { draftKey: string; sourceId: string; title: string; start: string; accountEmail: string }
export type WorkspaceRow = { key: string; title: string; start: string; searchText: string } & (
  | { kind: 'meeting'; meeting: MeetingListItem; event?: CalendarEventSummary; draft?: SavedAgendaDraft }
  | { kind: 'planned' | 'draft'; target: AgendaTarget }
)
type WorkspaceData = { meetings: MeetingListItem[]; meetingEvents: Map<string, CalendarEventSummary>; calendar: CalendarSnapshot | null; drafts: SavedAgendaDraft[] }

/** Only confirmed Calendar links collapse event/draft rows into an existing Meeting. */
export function workspaceRows(data: WorkspaceData, now = new Date()): { upcoming: WorkspaceRow[]; history: WorkspaceRow[] } {
  const linked = new Set(data.meetings.flatMap(meeting => {
    const event = data.meetingEvents.get(meeting.id)
    return event ? [agendaDraftKey(event)] : []
  }))
  const events = (data.calendar?.events ?? []).filter(event => new Date(event.end).getTime() >= now.getTime())
  const upcomingKeys = new Set(events.map(agendaDraftKey))
  const drafts = new Map(data.drafts.map(draft => [draft.draftKey, draft]))
  const upcoming = events.filter(event => !linked.has(agendaDraftKey(event))).map(event => eventRow(event, drafts.get(agendaDraftKey(event))))
  const history = data.meetings.map(meeting => meetingRow(meeting, data.meetingEvents.get(meeting.id), drafts))
  const saved = data.drafts.filter(draft => !upcomingKeys.has(draft.draftKey) && !linked.has(draft.draftKey)).map(draftRow)
  return { upcoming: upcoming.sort(ascending), history: [...history, ...saved].sort((a, b) => ascending(b, a)) }
}

export function filterWorkspaceRows(rows: WorkspaceRow[], query: string, meetingMatches: ReadonlySet<string>): WorkspaceRow[] {
  const term = query.trim().toLowerCase()
  return rows.filter(row => !term || row.searchText.includes(term) || row.kind === 'meeting' && meetingMatches.has(row.meeting.id))
}

export function currentAgendaEvent(target: AgendaTarget, calendar: CalendarSnapshot | null): CalendarEventSummary | undefined {
  return calendar?.events.find(event => agendaDraftKey(event) === target.draftKey)
}

function eventRow(event: CalendarEventSummary, draft?: SavedAgendaDraft): WorkspaceRow {
  const target = { draftKey: agendaDraftKey(event), sourceId: event.sourceId, title: event.title, start: event.start, accountEmail: event.accountEmail }
  return { key: `agenda:${target.draftKey}`, title: target.title, start: target.start, kind: 'planned', target, searchText: eventText(event, draft) }
}

function draftRow(draft: SavedAgendaDraft): WorkspaceRow {
  const target = { draftKey: draft.draftKey, sourceId: draft.sourceId, title: draft.title, start: draft.eventStart, accountEmail: draft.accountEmail }
  return { key: `agenda:${target.draftKey}`, title: target.title, start: target.start, kind: 'draft', target, searchText: draftText(draft) }
}

function meetingRow(meeting: MeetingListItem, event: CalendarEventSummary | undefined, drafts: Map<string, SavedAgendaDraft>): WorkspaceRow {
  const draft = event ? drafts.get(agendaDraftKey(event)) : undefined
  return { key: `meeting:${meeting.id}`, kind: 'meeting', title: meeting.title, start: meeting.startedAt, meeting, event, draft,
    searchText: `${meeting.title} ${event ? eventText(event, draft) : ''}`.toLowerCase() }
}

function eventText(event: CalendarEventSummary, draft?: SavedAgendaDraft): string {
  return `${event.title} ${event.accountEmail} ${event.location ?? ''} ${event.attendees?.map(person => `${person.name ?? ''} ${person.email}`).join(' ') ?? ''} ${draft ? draftText(draft) : ''}`.toLowerCase()
}

function draftText(draft: SavedAgendaDraft): string {
  return `${draft.title} ${draft.accountEmail} ${draft.items.map(item => item.topic).join(' ')}`.toLowerCase()
}

function ascending(a: WorkspaceRow, b: WorkspaceRow): number {
  return a.start.localeCompare(b.start) || a.key.localeCompare(b.key)
}
