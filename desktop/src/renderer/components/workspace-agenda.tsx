import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { calendarEventIsUpcoming } from '../../shared/meeting-agenda'
import { currentAgendaEvent, type AgendaTarget } from '../lib/meetings-workspace'
import type { AppView } from '../lib/app-view'
import { MeetingAgendaDraftPanel } from './meeting-agenda-draft'
import { Button } from './ui'
import './google-calendar.css'

export function WorkspaceAgenda({ target, view, onClose, onOpenSettings }: { target: AgendaTarget; view: AppView; onClose: () => void; onOpenSettings: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const event = currentAgendaEvent(target, view.calendar)
  const draft = view.drafts.find(item => item.draftKey === target.draftKey)
  const upcoming = Boolean(event && calendarEventIsUpcoming(event))
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [target.draftKey])
  return <article className="workspace-agenda" aria-label={`${event?.title ?? target.title} Agenda`}>
    <header className="app-panel-top"><div className="app-panel-titles"><p className="ui-eyebrow">{upcoming ? 'Agenda draft' : 'Saved Agenda draft'}</p><h1>{event?.title ?? draft?.title ?? target.title}</h1><p className="app-panel-meta">{new Date(event?.start ?? target.start).toLocaleString()} · {event?.accountEmail ?? target.accountEmail}</p></div><button ref={closeRef} type="button" className="app-icon-action" aria-label="Close Agenda" onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="workspace-agenda-body ui-scroll"><MeetingAgendaDraftPanel key={target.draftKey} draftKey={target.draftKey} sourceId={event?.sourceId ?? target.sourceId} canGenerate={upcoming} knownMeetingIds={new Set(view.meetings.map(meeting => meeting.id))} onOpenMeeting={view.actions.openMeeting} onOpenSettings={onOpenSettings} /></div>
    <footer className="app-panel-foot"><span className="app-block-note">Calendar is read-only. Topics are saved on this Mac.</span>{upcoming && event ? <Button variant="primary" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record Meeting</Button> : null}</footer>
  </article>
}
