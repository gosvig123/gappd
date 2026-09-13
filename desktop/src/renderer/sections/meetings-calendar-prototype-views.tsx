import type { ReactNode } from 'react'
import { CalendarDays, FileText, Mic } from 'lucide-react'
import { dateLabel, type Entry } from './meetings-calendar-prototype-data'

export type ViewProps = { entries: Entry[]; selected: string | null; open: (id: string) => void; recording: string | null; query: string; inlineContent?: ReactNode }
type RowProps = Pick<ViewProps, 'selected' | 'open' | 'recording' | 'inlineContent'> & { entry: Entry }

function EntryRow({ entry, selected, open, recording, inlineContent }: RowProps) {
  const Icon = entry.kind === 'planned' ? CalendarDays : entry.kind === 'recorded' ? Mic : FileText
  return <div className="mc-entry-wrap"><button className="mc-entry" data-entry-id={entry.id} aria-pressed={selected === entry.id} onClick={() => open(entry.id)}>
    <Icon size={17} aria-hidden="true" /><span className="mc-entry-copy"><strong>{entry.title}</strong><small>{dateLabel(entry.day)} at {entry.time}</small></span>
    <span className={`mc-kind mc-${entry.kind}`}>{recording === entry.id ? 'Recording demo' : entry.kind === 'planned' ? 'Planned' : entry.kind === 'recorded' ? 'Recorded' : 'Saved draft'}</span>
  </button>{selected === entry.id && inlineContent}</div>
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
      {upcoming.length > 1 && <details className="mc-more" open={upcoming.slice(1).some(e => e.id === props.selected)}><summary>{upcoming.length - 1} more upcoming</summary><EntryList {...props} entries={upcoming.slice(1)} /></details>}
    </section>}
    <section className="mc-group"><h2>History</h2><EntryList {...props} entries={past} /></section>
  </div>
}
