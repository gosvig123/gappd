import { useEffect, useRef } from 'react'
import { MapPin, Users, Video, X } from 'lucide-react'
import { calendarEventIsUpcoming, calendarEventKey } from '../../../shared/calendar-contract'
import { currentEvent, type CalendarTarget } from '../../lib/meetings-workspace'
import { eventPeople, eventPlace, eventTimeRange, type AppView } from '../../lib/app-view'
import { AgendaPanel } from '../agenda'
import { Button } from '../ui'

/** A Calendar event that has no Meeting yet: who and where, its Agenda, and Record for an upcoming event. */
export function WorkspaceEvent({ target, view, onClose }: { target: CalendarTarget; view: AppView; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const event = currentEvent(target, view.calendar)
  const upcoming = Boolean(event && calendarEventIsUpcoming(event))
  const people = event ? eventPeople(event, view.people) : null
  const place = event ? eventPlace(event) : null
  const Place = place?.call ? Video : MapPin
  // A past event keeps its Agenda only when one was written.
  const showAgenda = Boolean(event && (upcoming || view.agendas?.[calendarEventKey(event)]))
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [target.key])
  return <article className="workspace-event" aria-label={`${event?.title ?? target.title} Calendar event`}>
    <header className="app-panel-top"><div className="app-panel-titles"><p className="ui-eyebrow">Calendar event</p><h1>{event?.title ?? target.title}</h1><p className="app-panel-meta">{event ? eventTimeRange(event) : new Date(target.start).toLocaleString()} · {event?.accountEmail ?? target.accountEmail}</p></div><button ref={closeRef} type="button" className="app-icon-action" aria-label="Close Calendar event" onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="workspace-event-body">
      {people?.label || place ? <ul className="workspace-event-facts">
        {people?.label ? <li title={people.detail}><Users aria-hidden="true" />{people.label}</li> : null}
        {place ? <li><Place aria-hidden="true" />{place.label}</li> : null}
      </ul> : null}
      {showAgenda && event ? <div className="workspace-event-agenda"><h2>Agenda</h2><AgendaPanel key={calendarEventKey(event)} event={event} view={view} /></div> : null}
    </div>
    <footer className="app-panel-foot"><span className="app-block-note">Calendar is read-only.</span>{upcoming && event ? <Button className="record-action" disabled={!view.canStart} onClick={() => view.actions.start(event.sourceId)}><span className="app-record-dot" aria-hidden="true" />Record Meeting</Button> : null}</footer>
  </article>
}
