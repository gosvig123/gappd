import type { CalendarEventSummary, CalendarSnapshot } from '../../../shared/calendar-contract'
import type { SavedAgendaDraft } from '../../../shared/agenda-draft'
import { agendaDraftKey } from '../../../shared/agenda-draft'
import { at, minutesLater } from './time'

const WORK_ACCOUNT = 'krisitan@northwind.example'
const PERSONAL_ACCOUNT = 'krisitan.personal@example.com'
const NOW = new Date()

type EventSpec = { eventId: string; title: string; dayOffset: number; hour: number; minutes: number; account: string; location?: string; attendees: string[] }

const EVENT_SPECS: EventSpec[] = [
  { eventId: 'e-board', title: 'Quarterly board meeting', dayOffset: 3, hour: 11, minutes: 90, account: WORK_ACCOUNT, location: 'Zoom', attendees: ['Priya Raman', 'Marco Silva', 'Dana Whitfield'] },
  { eventId: 'e-northwind', title: 'Northwind renewal', dayOffset: 1, hour: 9, minutes: 45, account: WORK_ACCOUNT, attendees: ['Ana Petrova'] },
  { eventId: 'e-hiring', title: 'Hiring debrief — staff engineer', dayOffset: 1, hour: 14, minutes: 30, account: WORK_ACCOUNT, attendees: ['Priya Raman'] },
  { eventId: 'e-design', title: 'Design system review', dayOffset: 0, hour: NOW.getHours() + 1, minutes: 60, account: WORK_ACCOUNT, location: 'Studio', attendees: ['Dana Whitfield'] },
  { eventId: 'e-beacon', title: 'Customer call: Beacon Health', dayOffset: 0, hour: NOW.getHours() + 3, minutes: 45, account: PERSONAL_ACCOUNT, attendees: ['Ana Petrova'] },
  { eventId: 'e-planning', title: 'Quarterly planning kickoff', dayOffset: -1, hour: 14, minutes: 96, account: WORK_ACCOUNT, attendees: ['Priya Raman', 'Marco Silva'] },
  { eventId: 'e-interview', title: 'Customer interview — Beacon Health', dayOffset: -2, hour: 10, minutes: 41, account: PERSONAL_ACCOUNT, attendees: ['Ana Petrova'] },
]

export function seedCalendar(): CalendarSnapshot {
  return {
    configured: true,
    connections: [
      { id: 'conn-work', email: WORK_ACCOUNT, status: 'ready', lastSyncedAt: minutesLater(NOW, -12).toISOString() },
      { id: 'conn-personal', email: PERSONAL_ACCOUNT, status: 'error', error: 'Google sign-in expired. Reconnect to resume refresh. Last succeeded 4 days ago.' },
    ],
    events: EVENT_SPECS.map(toEvent),
  }
}

function toEvent(spec: EventSpec): CalendarEventSummary {
  const start = at(spec.dayOffset, spec.hour)
  return {
    connectionId: spec.account === WORK_ACCOUNT ? 'conn-work' : 'conn-personal',
    accountEmail: spec.account,
    calendarId: 'primary',
    eventId: spec.eventId,
    sourceId: `${spec.account}:primary:${spec.eventId}`,
    title: spec.title,
    start: start.toISOString(),
    end: minutesLater(start, spec.minutes).toISOString(),
    allDay: false,
    status: 'confirmed',
    location: spec.location,
    attendees: spec.attendees.map((name) => ({ email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@northwind.example`, name, responseStatus: 'accepted' })),
    organizer: { email: WORK_ACCOUNT, name: 'Krisitan Ahmadi' },
  }
}

const BOARD_TOPICS = [
  ['Time to first note is still the weakest number in the deck', 'm-05'],
  ['Search across transcripts, not just titles', 'm-06'],
  ['One alert surface instead of five stacked banners', 'm-07'],
] as const

const PLANNING_TOPICS = [
  ['Prototype the three layout directions before committing', 'm-05'],
  ['Define what searchable means for transcripts', 'm-06'],
] as const

export function seedAgendaDrafts(events: CalendarEventSummary[]): SavedAgendaDraft[] {
  const board = events.find((event) => event.eventId === 'e-board')
  const planning = events.find((event) => event.eventId === 'e-planning')
  return [board && draftOf(board, BOARD_TOPICS, 'gpt-5.1-codex', 'medium'), planning && draftOf(planning, PLANNING_TOPICS, 'local-ai', 'medium')].filter(Boolean) as SavedAgendaDraft[]
}

function draftOf(event: CalendarEventSummary, topics: ReadonlyArray<readonly [string, string]>, model: string, effort: string): SavedAgendaDraft {
  const stamp = minutesLater(NOW, -90).toISOString()
  return {
    draftKey: agendaDraftKey(event),
    sourceId: event.sourceId,
    title: event.title,
    accountEmail: event.accountEmail,
    eventStart: event.start,
    eventEnd: event.end,
    items: topics.map(([topic, sourceId]) => ({ topic, sourceId, quote: quoteFor(sourceId) })),
    sources: topics.map(([, sourceId]) => ({ id: sourceId, title: titleFor(sourceId), startedAt: startedAtFor(sourceId) })),
    historyIncomplete: false,
    generatedAt: stamp,
    updatedAt: stamp,
    model,
    reasoningEffort: effort,
    revision: 1,
    durable: true,
  }
}

const QUOTES: Record<string, string> = {
  'm-05': 'Three objectives. One: time to first note under ninety seconds.',
  'm-06': 'We search. Badly. Usually we scroll and guess.',
  'm-07': 'Keep: small pull requests. Change: stop adding banners.',
}

const TITLES: Record<string, string> = {
  'm-05': 'Quarterly planning kickoff',
  'm-06': 'Customer interview — Beacon Health',
  'm-07': 'Sprint retro',
}

const STARTED: Record<string, number> = { 'm-05': -1, 'm-06': -2, 'm-07': -3 }

function quoteFor(sourceId: string): string { return QUOTES[sourceId] ?? '' }
function titleFor(sourceId: string): string { return TITLES[sourceId] ?? '' }
function startedAtFor(sourceId: string): string { return at(STARTED[sourceId] ?? -1, 10).toISOString() }
