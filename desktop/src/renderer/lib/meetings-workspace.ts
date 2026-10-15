import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { MeetingListItem } from '../../shared/contracts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { calendarEventKey } from '../../shared/calendar-contract.ts'

export type CalendarTarget = { key: string; sourceId: string; title: string; start: string; accountEmail: string }
export type WorkspaceRow = { key: string; title: string; start: string; searchText: string } & (
  | { kind: 'meeting'; meeting: MeetingListItem; event?: CalendarEventSummary }
  | { kind: 'planned'; target: CalendarTarget }
)
type WorkspaceData = { meetings: MeetingListItem[]; meetingEvents: Map<string, CalendarEventSummary>; calendar: CalendarSnapshot | null }

/** Only confirmed Calendar links collapse an event row into an existing Meeting. */
export function workspaceRows(data: WorkspaceData, now = new Date()): { upcoming: WorkspaceRow[]; history: WorkspaceRow[] } {
  const linked = new Set(data.meetings.flatMap(meeting => {
    const event = data.meetingEvents.get(meeting.id)
    return event ? [calendarEventKey(event)] : []
  }))
  const events = (data.calendar?.events ?? []).filter(event => new Date(event.end).getTime() >= now.getTime())
  const upcoming = events.filter(event => !linked.has(calendarEventKey(event))).map(eventRow)
  const history = data.meetings.map(meeting => meetingRow(meeting, data.meetingEvents.get(meeting.id)))
  return { upcoming: upcoming.sort(ascending), history: history.sort((a, b) => ascending(b, a)) }
}

export function filterWorkspaceRows(rows: WorkspaceRow[], query: string, meetingMatches: ReadonlySet<string>): WorkspaceRow[] {
  const term = query.trim().toLowerCase()
  return rows.filter(row => !term || row.searchText.includes(term) || row.kind === 'meeting' && meetingMatches.has(row.meeting.id))
}

export function currentEvent(target: CalendarTarget, calendar: CalendarSnapshot | null): CalendarEventSummary | undefined {
  return calendar?.events.find(event => calendarEventKey(event) === target.key)
}

function eventRow(event: CalendarEventSummary): WorkspaceRow {
  const target = { key: calendarEventKey(event), sourceId: event.sourceId, title: event.title, start: event.start, accountEmail: event.accountEmail }
  return { key: `event:${target.key}`, title: target.title, start: target.start, kind: 'planned', target, searchText: eventText(event) }
}

function meetingRow(meeting: MeetingListItem, event: CalendarEventSummary | undefined): WorkspaceRow {
  return { key: `meeting:${meeting.id}`, kind: 'meeting', title: meeting.title, start: meeting.startedAt, meeting, event,
    searchText: `${meeting.title} ${event ? eventText(event) : ''}`.toLowerCase() }
}

function eventText(event: CalendarEventSummary): string {
  return `${event.title} ${event.accountEmail} ${event.location ?? ''} ${event.attendees?.map(person => `${person.name ?? ''} ${person.email}`).join(' ') ?? ''}`.toLowerCase()
}

function ascending(a: WorkspaceRow, b: WorkspaceRow): number {
  return a.start.localeCompare(b.start) || a.key.localeCompare(b.key)
}
