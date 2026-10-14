import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { calendarEventIsUpcoming } from '../../../shared/meeting-agenda'
import { currentAgendaEvent, type AgendaTarget } from '../../lib/meetings-workspace'
import type { AppView } from '../../lib/app-view'
import { MeetingAgendaDraftPanel } from './draft'
import { Button } from '../ui'
import { AGENDA_DRAFTS_ENABLED } from '../../lib/features'
import '../settings/google-calendar.css'

export function WorkspaceAgenda({ target, view, onClose, onOpenSettings }: { target: AgendaTarget; view: AppView; onClose: () => void; onOpenSettings: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const event = currentAgendaEvent(target, view.calendar)
  const draft = view.drafts.find(item => item.draftKey === target.draftKey)
  const upcoming = Boolean(event && calendarEventIsUpcoming(event))
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [target.draftKey])
  return <article className="workspace-agenda" aria-label={`${event?.title ?? target.title} ${AGENDA_DRAFTS_ENABLED ? 'Agenda' : 'Calendar event'}`}>
    <header className="app-panel-top"><div className="app-panel-titles"><p className="ui-eyebrow">{!AGENDA_DRAFTS_ENABLED ? 'Calendar event' : upcoming ? 'Agenda draft' : 'Saved Agenda draft'}</p><h1>{event?.title ?? draft?.title ?? target.title}</h1><p className="app-panel-meta">{new Date(event?.start ?? target.start).toLocaleString()} · {event?.accountEmail ?? target.accountEmail}</p></div><button ref={closeRef} type="button" className="app-icon-action" aria-label={AGENDA_DRAFTS_ENABLED ? 'Close Agenda' : 'Close Calendar event'} onClick={onClose}><X aria-hidden="true" /></button></header>
    {AGENDA_DRAFTS_ENABLED ? <div className="workspace-agenda-body ui-scroll"><MeetingAgendaDraftPanel key={target.draftKey} draftKey={target.draftKey} sourceId={event?.sourceId ?? target.sourceId} canGenerate={upcoming} knownMeetingIds={new Set(view.meetings.map(meeting => meeting.id))} onOpenMeeting={view.actions.openMeeting} onOpenSettings={onOpenSettings} /></div> : <div className="workspace-agenda-body" />}
    <footer className="app-panel-foot"><span className="app-block-note">{AGENDA_DRAFTS_ENABLED ? 'Calendar is read-only. Topics are saved on this Mac.' : 'Calendar is read-only.'}</span>{upcoming && event ? <Button variant="primary" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record Meeting</Button> : null}</footer>
  </article>
}
