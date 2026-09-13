import { useState } from 'react'
import { CalendarDays, FileText, Mic } from 'lucide-react'
import { dateLabel, type Entry } from './meetings-calendar-prototype-data'

type ViewProps = { entries: Entry[]; selected: string | null; open: (id: string) => void; recording: string | null; query: string }
type RowProps = Pick<ViewProps, 'selected' | 'open' | 'recording'> & { entry: Entry }

export function EntryRow({ entry, selected, open, recording }: RowProps) {
  const Icon = entry.kind === 'planned' ? CalendarDays : entry.kind === 'recorded' ? Mic : FileText
  return <button className="mc-entry" aria-pressed={selected === entry.id} onClick={() => open(entry.id)}>
    <Icon size={17} aria-hidden="true" /><span className="mc-entry-copy"><strong>{entry.title}</strong><small>{dateLabel(entry.day)} at {entry.time}</small></span>
    <span className={`mc-kind mc-${entry.kind}`}>{recording === entry.id ? 'Recording demo' : entry.kind === 'planned' ? 'Planned' : entry.kind === 'recorded' ? 'Recorded' : 'Saved draft'}</span>
  </button>
}

function EntryList(props: ViewProps) {
  return <div className="mc-list">{props.entries.length ? props.entries.map(entry => <EntryRow key={entry.id} {...props} entry={entry} />) : <p className="mc-empty">Nothing here yet.</p>}</div>
}

function ordered(entries: Entry[], planned: boolean) {
  return entries.filter(e => (e.kind === 'planned') === planned).sort((a, b) => (planned ? 1 : -1) * `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`))
}

export function NextHistory(props: ViewProps) {
  const upcoming = ordered(props.entries, true)
  const past = ordered(props.entries, false)
  if (props.query.trim()) return <EntryList {...props} />
  return <div className="mc-next-history">
    {upcoming[0] && <section className="mc-next"><h2>Next up</h2><EntryRow {...props} entry={upcoming[0]} />
      {upcoming.length > 1 && <details className="mc-more"><summary>{upcoming.length - 1} more upcoming</summary><EntryList {...props} entries={upcoming.slice(1)} /></details>}
    </section>}
    <section className="mc-group"><h2>History</h2><EntryList {...props} entries={past} /></section>
  </div>
}

export function UpcomingPast(props: ViewProps) {
  const [period, setPeriod] = useState<'upcoming' | 'past'>(() => props.entries.some(e => e.kind === 'planned') ? 'upcoming' : 'past')
  if (props.query.trim()) return <section className="mc-group"><h2>Search across upcoming and past</h2><EntryList {...props} /></section>
  return <div><nav className="mc-period" aria-label="Meeting period"><button aria-pressed={period === 'upcoming'} onClick={() => setPeriod('upcoming')}>Upcoming</button><button aria-pressed={period === 'past'} onClick={() => setPeriod('past')}>Past</button></nav><EntryList {...props} entries={ordered(props.entries, period === 'upcoming')} /></div>
}

export function OneList(props: ViewProps) {
  const upcoming = ordered(props.entries, true)
  const past = ordered(props.entries, false)
  return <div className="mc-one-list">{upcoming.length > 0 && <EntryList {...props} entries={upcoming} />}{past.length > 0 && <><div className="mc-past-divider">Past</div><EntryList {...props} entries={past} /></>}</div>
}

export function EntryDetails({ entry, note, updateNote, recording, record, close }: { entry: Entry; note: string; updateNote: (value: string) => void; recording: string | null; record: () => void; close: () => void }) {
  return <section className="mc-detail" aria-label="Selected item details"><header><span>{entry.kind === 'recorded' ? 'Recorded Meeting' : entry.kind === 'planned' ? 'Calendar event' : 'Saved Agenda draft'}</span><button onClick={close} aria-label="Close details">×</button></header><h2>{entry.title}</h2><p>{dateLabel(entry.day)} at {entry.time}<br />{entry.people}</p>
    {entry.kind === 'recorded' ? <><h3>Summary</h3><p>{note}</p><h3>Transcript preview</h3><p className="mc-transcript">Alex: “Let’s confirm the next step before we finish.”<br /><br />You: “I’ll bring the updated version to our next Meeting.”</p></> : <><label className="mc-agenda-label">{entry.kind === 'draft' ? 'Saved topics' : 'Agenda draft'}<textarea value={note} onChange={e => updateNote(e.target.value)} rows={6} /></label><p className="mc-muted">{entry.kind === 'draft' ? 'The event has passed. Saved topics remain editable on this Mac.' : 'Topics are demo content. Editing does not change the Calendar event.'}</p></>}
    {entry.kind === 'planned' && <button className="mc-primary" disabled={!!recording && recording !== entry.id} onClick={record}>{recording === entry.id ? 'Stop demo recording' : 'Record demo Meeting'}</button>}
    <p className="mc-muted">Preview only. No audio capture, AI processing, or Calendar changes.</p>
  </section>
}
