import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { calendarEventIsUpcoming } from '../../../shared/calendar-contract'
import { currentEvent, type CalendarTarget } from '../../lib/meetings-workspace'
import type { AppView } from '../../lib/app-view'
import { Button } from '../ui'

/** A Calendar event that has no Meeting yet. An upcoming event can be recorded from here. */
export function WorkspaceEvent({ target, view, onClose }: { target: CalendarTarget; view: AppView; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const event = currentEvent(target, view.calendar)
  const upcoming = Boolean(event && calendarEventIsUpcoming(event))
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [target.key])
  return <article className="workspace-event" aria-label={`${event?.title ?? target.title} Calendar event`}>
    <header className="app-panel-top"><div className="app-panel-titles"><p className="ui-eyebrow">Calendar event</p><h1>{event?.title ?? target.title}</h1><p className="app-panel-meta">{new Date(event?.start ?? target.start).toLocaleString()} · {event?.accountEmail ?? target.accountEmail}</p></div><button ref={closeRef} type="button" className="app-icon-action" aria-label="Close Calendar event" onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="workspace-event-body" />
    <footer className="app-panel-foot"><span className="app-block-note">Calendar is read-only.</span>{upcoming && event ? <Button variant="primary" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}>Record Meeting</Button> : null}</footer>
  </article>
}
