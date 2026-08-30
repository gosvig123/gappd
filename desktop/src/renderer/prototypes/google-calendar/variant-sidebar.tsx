import { CalendarDays, Check, ChevronRight, CircleUserRound, LockKeyhole, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { type CalendarPrototypeProps, PROTOTYPE_CALENDARS, calendarFor, visibleEvents } from './model'

export function SidebarVariant(props: CalendarPrototypeProps) {
  return <div className="proto-shell proto-settings"><SettingsNav /><main className="settings-canvas"><header><span className="proto-eyebrow">Settings</span><h1>Calendar</h1><p>Choose which meetings Gappd can help you prepare for.</p></header><div className="settings-columns"><IntegrationCard {...props} /><CalendarPreview {...props} /></div></main></div>
}

function SettingsNav() {
  return <aside className="settings-nav"><div className="proto-brand"><span className="proto-logo">G</span><strong>Gappd</strong></div><nav><button><Settings2 /> General</button><button><CircleUserRound /> Meeting summaries</button><button className="active"><CalendarDays /> Calendar</button></nav><div className="settings-nav-note"><LockKeyhole /><span><strong>Private by default</strong><small>Recorded audio and notes stay on this Mac.</small></span></div></aside>
}

function IntegrationCard(props: CalendarPrototypeProps) {
  return <section className="integration-card"><div className="integration-title"><div className="google-badge">G</div><div><h2>Google Calendar</h2><p>{connectionCopy(props.step)}</p></div><span className={props.step === 'connected' ? 'connection-pill on' : 'connection-pill'}>{props.step === 'connected' ? 'Connected' : 'Not connected'}</span></div>{props.step === 'disconnected' ? <ConnectDetails onConnect={props.onConnect} /> : null}{props.step === 'selecting' ? <SettingsCalendarSelection {...props} /> : null}{props.step === 'connected' ? <ConnectionDetails {...props} /> : null}</section>
}

function ConnectDetails({ onConnect }: { onConnect: () => void }) {
  return <div className="integration-body"><div className="permission-row"><ShieldCheck /><span><strong>Read-only calendar access</strong><small>Gappd imports event time, title, guests, and meeting link.</small></span></div><div className="permission-row"><LockKeyhole /><span><strong>Stored locally</strong><small>Calendar events are cached on this Mac and removed on disconnect.</small></span></div><button className="proto-primary" onClick={onConnect}>Continue with Google</button></div>
}

function SettingsCalendarSelection(props: CalendarPrototypeProps) {
  return <div className="integration-body"><div className="selection-heading"><strong>Calendars to show</strong><span>{props.selected.length} selected</span></div>{PROTOTYPE_CALENDARS.map((calendar) => <label className="settings-calendar-row" key={calendar.id}><input type="checkbox" checked={props.selected.includes(calendar.id)} onChange={() => props.onToggleCalendar(calendar.id)} /><i style={{ background: calendar.color }} /><span><strong>{calendar.name}</strong><small>{calendar.account}</small></span></label>)}<button className="proto-primary" disabled={!props.selected.length} onClick={props.onFinishSelection}>Save calendar selection</button></div>
}

function ConnectionDetails(props: CalendarPrototypeProps) {
  return <div className="integration-body"><div className="account-row"><CircleUserRound /><span><strong>krisitan@gmail.com</strong><small>{props.selected.length} calendars · synced just now</small></span></div><div className="selected-settings">{props.selected.map((id) => <button key={id}><i style={{ background: calendarFor(id).color }} />{calendarFor(id).name}<ChevronRight /></button>)}</div><div className="integration-actions"><button className="proto-secondary"><RefreshCw /> Sync now</button><button className="proto-link danger" onClick={props.onDisconnect}>Disconnect</button></div></div>
}

function CalendarPreview(props: CalendarPrototypeProps) {
  const events = props.step === 'connected' ? visibleEvents(props.selected).slice(0, 3) : []
  return <aside className="calendar-preview"><div><span className="proto-eyebrow">Today preview</span><h2>How events will appear</h2></div>{events.length ? events.map((event) => <div className="preview-event" key={event.id}><i style={{ background: calendarFor(event.calendarId).color }} /><time>{event.time}</time><span><strong>{event.title}</strong><small>{calendarFor(event.calendarId).name}</small></span><button onClick={() => props.onRecord(event.id)}>{props.recordingId === event.id ? 'Stop' : 'Record'}</button></div>) : <div className="preview-empty"><CalendarDays /><p>Connect and choose calendars to preview your upcoming meetings.</p></div>}</aside>
}

function connectionCopy(step: CalendarPrototypeProps['step']): string {
  if (step === 'selecting') return 'Choose what appears in Gappd.'
  if (step === 'connected') return 'Upcoming meetings are available in Today.'
  return 'Add upcoming meetings to Gappd.'
}
