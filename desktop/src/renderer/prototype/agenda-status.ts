import { agendaDraftKey, type SavedAgendaDraft } from '../../shared/agenda-draft'
import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { PrototypeView } from './contract'

/**
 * An Agenda belongs to a Calendar event, not to a Meeting. A Meeting shows one
 * only when it is linked to a Calendar event.
 */
export type AgendaState =
  | { kind: 'unlinked' }
  | { kind: 'empty'; event: CalendarEventSummary }
  | { kind: 'saved'; event: CalendarEventSummary; draft: SavedAgendaDraft }

export function agendaStateForEvent(event: CalendarEventSummary, drafts: SavedAgendaDraft[]): AgendaState {
  const draft = drafts.find((item) => item.draftKey === agendaDraftKey(event))
  return draft ? { kind: 'saved', event, draft } : { kind: 'empty', event }
}

export function agendaStateForMeeting(view: PrototypeView, meetingId: string): AgendaState {
  const event = view.meetingEvents.get(meetingId)
  if (!event) return { kind: 'unlinked' }
  return agendaStateForEvent(event, view.drafts)
}

export function agendaTopicCount(state: AgendaState): number {
  return state.kind === 'saved' ? state.draft.items.length : 0
}

/**
 * Row label. An unlinked Meeting stays quiet: the chip should mark real Agenda
 * work, not repeat "no calendar event" on most rows.
 */
export function agendaChipLabel(state: AgendaState): string | null {
  if (state.kind === 'unlinked') return null
  if (state.kind === 'empty') return 'Agenda · none'
  const count = agendaTopicCount(state)
  return `Agenda · ${count} ${count === 1 ? 'topic' : 'topics'}`
}

export function agendaTabLabel(state: AgendaState): string {
  const count = agendaTopicCount(state)
  return count ? `Agenda · ${count}` : 'Agenda'
}
