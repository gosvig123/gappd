import { CalendarDays, Check, Clock3, Link2, Settings, Users, Video } from 'lucide-react'
import { type CalendarPrototypeProps, PROTOTYPE_CALENDARS, calendarFor, visibleEvents } from './model'

export function AgendaVariant(props: CalendarPrototypeProps) {
  return <div className="proto-shell proto-agenda"><PrototypeHeader label="Today" /><main className="agenda-layout"><section className="agenda-main"><div className="agenda-heading"><div><span className="proto-eyebrow">Friday, August 29</span><h1>Your day</h1><p>{props.step === 'connected' ? 'Four meetings across your calendars.' : 'Connect Google Calendar to see what is next.'}</p></div><button className="proto-icon-button" aria-label="Calendar settings"><Settings /></button></div><AgendaEvents {...props} /></section><AgendaConnection {...props} /></main></div>
}

function PrototypeHeader({ label }: { label: string }) {
  return <header className="proto-header"><div className="proto-brand"><span className="proto-logo">G</span><strong>Gappd</strong></div><nav><button className="active">{label}</button><button>Meetings</button></nav><div className="proto-avatar">KS</div></header>
}

function AgendaEvents(props: CalendarPrototypeProps) {
  const events = props.step === 'connected' ? visibleEvents(props.selected) : []
  if (!events.length) return <div className="agenda-empty"><CalendarDays /><h2>No calendar connected</h2><p>Your recorded meetings still stay private on this Mac.</p><button className="proto-primary" onClick={props.onConnect}>Connect Google Calendar</button></div>
  return <div className="agenda-events">{events.map((event) => <article className="agenda-event" key={event.id} style={{ '--event-color': calendarFor(event.calendarId).color } as React.CSSProperties}><time>{event.time}<small>{event.duration}</small></time><div className="agenda-event-line" /><div className="agenda-event-copy"><span className="proto-source">{calendarFor(event.calendarId).name}</span><h2>{event.title}</h2><p><Users /> {event.people} <span>·</span> <Video /> {event.location}</p></div><button className={props.recordingId === event.id ? 'proto-record is-recording' : 'proto-record'} onClick={() => props.onRecord(event.id)}>{props.recordingId === event.id ? 'Stop' : 'Record'}</button></article>)}</div>
}

function AgendaConnection(props: CalendarPrototypeProps) {
  return <aside className="agenda-side"><span className="proto-eyebrow">Calendar connection</span>{props.step === 'disconnected' ? <Disconnected onConnect={props.onConnect} /> : null}{props.step === 'selecting' ? <CalendarSelection {...props} /> : null}{props.step === 'connected' ? <ConnectedCalendars {...props} /> : null}</aside>
}

function Disconnected({ onConnect }: { onConnect: () => void }) {
  return <><div className="google-badge">G</div><h2>Plan from your real day</h2><p>Bring upcoming event titles and times into Gappd. Audio and notes still stay on this Mac.</p><button className="proto-primary wide" onClick={onConnect}>Connect Google Calendar</button><small className="proto-privacy"><Link2 /> Read-only access</small></>
}

function CalendarSelection(props: CalendarPrototypeProps) {
  return <><h2>Choose calendars</h2><p>Select what should appear in Today.</p><div className="calendar-choice-list">{PROTOTYPE_CALENDARS.map((calendar) => <button key={calendar.id} className={props.selected.includes(calendar.id) ? 'calendar-choice selected' : 'calendar-choice'} onClick={() => props.onToggleCalendar(calendar.id)}><span className="calendar-dot" style={{ background: calendar.color }} /><span><strong>{calendar.name}</strong><small>{calendar.account}</small></span>{props.selected.includes(calendar.id) ? <Check /> : null}</button>)}</div><button className="proto-primary wide" disabled={!props.selected.length} onClick={props.onFinishSelection}>Show selected calendars</button></>
}

function ConnectedCalendars(props: CalendarPrototypeProps) {
  return <><div className="connection-ok"><Check /> Connected</div><h2>Google Calendar</h2><p>Last synced just now</p><div className="selected-chips">{props.selected.map((id) => <span key={id}><i style={{ background: calendarFor(id).color }} />{calendarFor(id).name}</span>)}</div><div className="sync-note"><Clock3 /> Gappd refreshes when the app opens.</div><button className="proto-link danger" onClick={props.onDisconnect}>Disconnect</button></>
}
