import { agendaDraftKey } from '../../../shared/agenda-draft'
import { calendarEventIsUpcoming } from '../../../shared/meeting-agenda'
import type { CalendarEventSummary } from '../../../shared/calendar-contract'
import { MeetingAgendaDraftPanel } from '../../components/meeting-agenda-draft'
import { EmptyState } from '../../components/ui'
import { agendaChipLabel, agendaStateForEvent, agendaStateForMeeting, type AgendaState } from '../agenda-status'
import type { PrototypeView } from '../contract'
import './c-agenda.css'

/**
 * A compact Agenda marker for a preview line. It renders nothing when the
 * Meeting has no Calendar event, so the row only carries real Agenda work.
 */
export function AgendaChip({ state, onOpen }: { state: AgendaState; onOpen?: () => void }) {
  const label = agendaChipLabel(state)
  if (!label) return null
  const className = state.kind === 'saved' ? 'vc-agenda-chip is-ready' : 'vc-agenda-chip'
  if (!onOpen) return <span className={className}>{label}</span>
  return <button type="button" className={className} onClick={onOpen}>{label}</button>
}

/** Agenda chip for a Meeting, used on Meeting preview lines. */
export function MeetingAgendaChip({ view, meetingId, onOpen }: { view: PrototypeView; meetingId: string; onOpen?: () => void }) {
  return <AgendaChip state={agendaStateForMeeting(view, meetingId)} onOpen={onOpen} />
}

/** Agenda chip for a Calendar event, used on upcoming event lines. */
export function EventAgendaChip({ view, event }: { view: PrototypeView; event: CalendarEventSummary }) {
  return <AgendaChip state={agendaStateForEvent(event, view.drafts)} />
}

/**
 * The Agenda tab body. Draft editing is the production Agenda editor, so
 * generate, save, and delete all behave as they do in the shipped app.
 */
export function AgendaPane({ view, meetingId, onOpenSettings }: { view: PrototypeView; meetingId: string; onOpenSettings: () => void }) {
  const state = agendaStateForMeeting(view, meetingId)
  if (state.kind === 'unlinked') {
    return (
      <EmptyState>
        This Meeting is not linked to a Calendar event, so it has no Agenda.
        Link one under “People in this meeting”, then the prepared topics appear here.
      </EmptyState>
    )
  }
  const event = state.event
  return (
    <div className="vc-agenda-pane">
      <p className="vc-agenda-source">
        <strong>{event.title}</strong>
        <span>{new Date(event.start).toLocaleString()} · {event.accountEmail}</span>
      </p>
      <MeetingAgendaDraftPanel
        draftKey={agendaDraftKey(event)}
        sourceId={event.sourceId}
        canGenerate={calendarEventIsUpcoming(event)}
        knownMeetingIds={new Set(view.meetings.map((meeting) => meeting.id))}
        onOpenMeeting={view.actions.openMeeting}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}
