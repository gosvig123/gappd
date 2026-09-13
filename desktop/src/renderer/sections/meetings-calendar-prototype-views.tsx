import { useState } from 'react'
import { CalendarDays, FileText, Mic, ArrowUpRight } from 'lucide-react'
import { dateLabel, days, type Entry } from './meetings-calendar-prototype-data'

type ViewProps = { entries: Entry[]; selected: string | null; open: (id: string) => void; recording: string | null; query: string; showDate?: boolean }
type RowProps = Pick<ViewProps, 'selected' | 'open' | 'recording' | 'showDate'> & { entry: Entry }

export function EntryRow({ entry, selected, open, recording, showDate }: RowProps) {
  const Icon = entry.kind === 'planned' ? CalendarDays : entry.kind === 'recorded' ? Mic : FileText
  return <button className="mc-entry" aria-pressed={selected === entry.id} onClick={() => open(entry.id)}>
    <span className="mc-time">{entry.time}</span><Icon size={17} aria-hidden="true" />
    <span className="mc-entry-copy"><strong>{entry.title}</strong><small>{showDate ? `${dateLabel(entry.day)} · ` : ''}{entry.people}</small><small>{entry.linked ? 'Calendar linked · ' : ''}{entry.kind === 'recorded' ? 'Summary and transcript' : entry.kind === 'draft' ? 'Saved Agenda draft · no recording' : 'Calendar event · not recorded'}</small></span>
    <span className={`mc-kind mc-${entry.kind}`}>{recording === entry.id ? 'Recording demo' : entry.kind === 'planned' ? 'Planned' : entry.kind === 'recorded' ? 'Recorded' : 'Saved draft'}</span><ArrowUpRight size={16} aria-hidden="true" />
  </button>
}

function Group({ title, entries, ...props }: Omit<ViewProps, 'query'> & { title: string }) {
  return <section className="mc-group"><h2>{title}<span>{entries.length}</span></h2>{entries.length ? entries.map(entry => <EntryRow key={entry.id} entry={entry} {...props} />) : <p className="mc-empty">Nothing to show here.</p>}</section>
}

export function Timeline(props: ViewProps) {
  const ordered = [days[1], days[2], days[3], days[0]]
  return <div className="mc-timeline">{ordered.filter(day => props.entries.some(e => e.day === day)).map(day => <Group key={day} {...props} title={`${day === days[1] ? 'Today · ' : ''}${dateLabel(day)}`} entries={props.entries.filter(e => e.day === day).sort((a, b) => a.time.localeCompare(b.time))} />)}</div>
}

export function SplitView(props: ViewProps) {
  const planned = props.entries.filter(e => e.kind === 'planned')
  const recorded = props.entries.filter(e => e.kind === 'recorded')
  const drafts = props.entries.filter(e => e.kind === 'draft')
  return <div className="mc-split"><aside><Group {...props} showDate title="Coming up" entries={planned} />{drafts.length > 0 && <Group {...props} showDate title="Saved Agenda drafts" entries={drafts} />}</aside><section className="mc-history"><h2>Meeting history</h2><p>Recordings stay here, with or without Calendar.</p>{[days[1], days[0]].map(day => <Group key={day} {...props} title={dateLabel(day)} entries={recorded.filter(e => e.day === day)} />)}</section></div>
}

export function DayBrowser(props: ViewProps) {
  const [day, setDay] = useState(days[1])
  const entries = props.entries.filter(e => e.day === day).sort((a, b) => a.time.localeCompare(b.time))
  if (props.query.trim()) return <Group {...props} showDate title="Search results across all days" />
  return <div className="mc-day-browser"><nav className="mc-date-strip" aria-label="Choose a day">{days.map(d => <button key={d} aria-pressed={day === d} onClick={() => setDay(d)}><span>{dateLabel(d)}</span><small>{dayCount(props.entries, d)}</small></button>)}</nav><Group {...props} title={dateLabel(day)} entries={entries} /><p className="mc-muted">Choose another day to browse planned events, recordings, and Saved Agenda drafts together.</p></div>
}

function dayCount(entries: Entry[], day: string) {
  const count = entries.filter(entry => entry.day === day).length
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

export function EntryDetails({ entry, note, updateNote, recording, record, close }: { entry: Entry; note: string; updateNote: (value: string) => void; recording: string | null; record: () => void; close: () => void }) {
  return <section className="mc-detail" aria-label="Selected item details"><header><span>{entry.kind === 'recorded' ? 'Recorded Meeting' : entry.kind === 'planned' ? 'Calendar event' : 'Saved Agenda draft'}</span><button onClick={close} aria-label="Close details">×</button></header><h2>{entry.title}</h2><p>{dateLabel(entry.day)} at {entry.time}<br />{entry.people}</p>
    {entry.kind === 'recorded' ? <><h3>Summary</h3><p>{note}</p><h3>Transcript preview</h3><p className="mc-transcript">Alex: “Let’s confirm the next step before we finish.”<br /><br />You: “I’ll bring the updated version to our next Meeting.”</p></> : <><label className="mc-agenda-label">{entry.kind === 'draft' ? 'Saved topics' : 'Agenda draft'}<textarea value={note} onChange={e => updateNote(e.target.value)} rows={6} /></label><p className="mc-muted">{entry.kind === 'draft' ? 'The event has passed. Saved topics remain editable on this Mac.' : 'Topics are demo content. Editing does not change the Calendar event.'}</p></>}
    {entry.kind === 'planned' && <button className="mc-primary" disabled={!!recording && recording !== entry.id} onClick={record}>{recording === entry.id ? 'Stop demo recording' : 'Record demo Meeting'}</button>}
    <p className="mc-muted">Preview only. No audio capture, AI processing, or Calendar changes.</p>
  </section>
}
