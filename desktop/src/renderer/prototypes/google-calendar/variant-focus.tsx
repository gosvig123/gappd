import { CalendarCheck2, Check, ChevronDown, Clock3, Link2, Mic2, Plus, Sparkles, Video } from 'lucide-react'
import { type CalendarPrototypeProps, PROTOTYPE_CALENDARS, calendarFor, visibleEvents } from './model'

export function FocusVariant(props: CalendarPrototypeProps) {
  return <div className="proto-shell proto-focus"><FocusHeader {...props} /><main className="focus-main"><SetupRail {...props} /><Timeline {...props} /></main></div>
}

function FocusHeader(props: CalendarPrototypeProps) {
  return <header className="focus-header"><div className="proto-brand"><span className="proto-logo">G</span><strong>Gappd</strong></div><div className="focus-date"><button>Today <ChevronDown /></button><strong>Friday 29 August</strong></div><div className="focus-actions"><button className="proto-secondary"><Plus /> New recording</button><span className="proto-avatar">KS</span></div></header>
}

function SetupRail(props: CalendarPrototypeProps) {
  if (props.step === 'connected') return <ConnectedRail {...props} />
  return <section className="setup-rail"><div className="setup-progress"><Step number="1" active={props.step === 'disconnected'} done={props.step === 'selecting'} label="Connect" /><span /><Step number="2" active={props.step === 'selecting'} done={false} label="Choose calendars" /><span /><Step number="3" active={false} done={false} label="Use in Today" /></div>{props.step === 'disconnected' ? <RailConnect onConnect={props.onConnect} /> : <RailSelection {...props} />}</section>
}

function Step({ number, active, done, label }: { number: string; active: boolean; done: boolean; label: string }) {
  return <div className={active ? 'rail-step active' : done ? 'rail-step done' : 'rail-step'}><b>{done ? <Check /> : number}</b><span>{label}</span></div>
}

function RailConnect({ onConnect }: { onConnect: () => void }) {
  return <div className="rail-connect"><div><span className="proto-eyebrow">Bring your schedule into focus</span><h1>Know what is next. Record when you are ready.</h1><p>Gappd reads your event schedule. Audio, transcripts, and notes remain local.</p></div><button className="google-connect" onClick={onConnect}><span>G</span> Connect Google Calendar</button></div>
}

function RailSelection(props: CalendarPrototypeProps) {
  return <div className="rail-selection"><div><span className="proto-eyebrow">Choose calendars</span><h1>What belongs in your Gappd day?</h1></div><div className="rail-calendar-options">{PROTOTYPE_CALENDARS.map((calendar) => <button key={calendar.id} className={props.selected.includes(calendar.id) ? 'selected' : ''} onClick={() => props.onToggleCalendar(calendar.id)}><i style={{ background: calendar.color }} /><span><strong>{calendar.name}</strong><small>{calendar.account}</small></span>{props.selected.includes(calendar.id) ? <Check /> : null}</button>)}</div><button className="proto-primary" disabled={!props.selected.length} onClick={props.onFinishSelection}>Build my day</button></div>
}

function ConnectedRail(props: CalendarPrototypeProps) {
  return <section className="connected-rail"><div><CalendarCheck2 /><span><strong>Google Calendar connected</strong><small>Synced just now</small></span></div><div className="rail-filters">{PROTOTYPE_CALENDARS.map((calendar) => <button key={calendar.id} className={props.selected.includes(calendar.id) ? 'selected' : ''} onClick={() => props.onToggleCalendar(calendar.id)}><i style={{ background: calendar.color }} />{calendar.name}</button>)}</div><button className="proto-link" onClick={props.onDisconnect}>Disconnect</button></section>
}

function Timeline(props: CalendarPrototypeProps) {
  const events = props.step === 'connected' ? visibleEvents(props.selected) : []
  return <section className="timeline"><aside><span>09</span><span>10</span><span>11</span><span>12</span><span>13</span><span>14</span><span>15</span><span>16</span></aside><div className="timeline-canvas"><div className="now-line"><b>09:42</b></div>{events.length ? events.map((event) => <TimelineEvent key={event.id} event={event} {...props} />) : <TimelineBlank />}</div></section>
}

function TimelineEvent({ event, recordingId, onRecord }: { event: ReturnType<typeof visibleEvents>[number]; recordingId: string | null; onRecord: (id: string) => void }) {
  const style = { '--event-offset': timelineOffset(event.time), '--event-color': calendarFor(event.calendarId).color } as React.CSSProperties
  return <article className="timeline-event" style={style}><div className="timeline-time"><Clock3 /> {event.time} · {event.duration}</div><span className="proto-source">{calendarFor(event.calendarId).name}</span><h2>{event.title}</h2><p><Video /> {event.location}</p><button className={recordingId === event.id ? 'is-recording' : ''} onClick={() => onRecord(event.id)}><Mic2 /> {recordingId === event.id ? 'Stop recording' : 'Record meeting'}</button></article>
}

function timelineOffset(time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return `${Math.max(0, hour + minute / 60 - 10) * 4.5}rem`
}

function TimelineBlank() {
  return <div className="timeline-blank"><Sparkles /><h2>Your calendar will shape this timeline</h2><p>Connect Google Calendar above to place upcoming meetings in the day.</p><span><Link2 /> Read-only prototype data</span></div>
}
