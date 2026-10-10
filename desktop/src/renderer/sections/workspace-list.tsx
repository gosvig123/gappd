import { CircleAlert } from 'lucide-react'
import type { WorkspaceRow } from '../lib/meetings-workspace'
import { artifactNote } from '../lib/app-view'
import { dayLabel } from '../lib/meeting-grouping'
import { meetingFailed } from '../components/meeting-progress'
import { cx } from '../components/ui'

type Props = { upcoming: WorkspaceRow[]; history: WorkspaceRow[]; selectedKey: string | null; searching: boolean; onSelect: (row: WorkspaceRow, trigger: HTMLButtonElement) => void }

export function WorkspaceList({ upcoming, history, selectedKey, searching, onSelect }: Props) {
  const rows = { selectedKey, onSelect }
  if (searching) return <section aria-label="Search results"><DayGroups rows={[...upcoming, ...history]} {...rows} /></section>
  const [next, ...later] = upcoming
  return <>
    <section className="workspace-next" aria-label="Next up"><h2>Next up</h2>{next ? <WorkspaceRowButton row={next} next {...rows} /> : <p className="app-block-note">No upcoming Calendar events. You can still record a Meeting.</p>}
      {later.length ? <details open={later.some(row => row.key === selectedKey)}><summary>{later.length} more upcoming</summary><DayGroups rows={later} {...rows} /></details> : null}
    </section>
    <section className="workspace-history" aria-label="Meeting history"><h2>History</h2>{history.length ? <DayGroups rows={history} {...rows} /> : <p className="app-block-note">No Meetings or Saved Agenda drafts yet. Press Record to capture your first Meeting.</p>}</section>
  </>
}

/** Rows under "Today", "Yesterday", or a full date, so each row shows only its time. */
function DayGroups({ rows, ...props }: Pick<Props, 'selectedKey' | 'onSelect'> & { rows: WorkspaceRow[] }) {
  if (!rows.length) return <p className="app-block-note">No matching Meetings, events, or Agenda topics.</p>
  const days = new Map<string, WorkspaceRow[]>()
  for (const row of rows) days.set(dayLabel(row.start), [...(days.get(dayLabel(row.start)) ?? []), row])
  return <>{[...days].map(([day, items]) => <div key={day} className="workspace-day"><h3>{day}</h3>{items.map(row => <WorkspaceRowButton key={row.key} row={row} {...props} />)}</div>)}</>
}

function WorkspaceRowButton({ row, next = false, selectedKey, onSelect }: Pick<Props, 'selectedKey' | 'onSelect'> & { row: WorkspaceRow; next?: boolean }) {
  const failed = row.kind === 'meeting' && meetingFailed(row.meeting)
  // Only unusual states get a label; a finished Meeting or a planned event stays quiet.
  const note = row.kind === 'meeting' ? (failed ? 'Failed' : artifactNote(row.meeting)) : row.kind === 'draft' ? 'Saved draft' : next ? dayLabel(row.start) : null
  const detail = row.kind === 'meeting' ? undefined : row.kind === 'planned' ? 'Calendar event; not recorded' : 'Saved Agenda draft; no recording'
  return <button type="button" className={cx('workspace-row', next && 'is-next')} data-workspace-key={row.key} aria-current={row.key === selectedKey ? 'true' : undefined} onClick={event => onSelect(row, event.currentTarget)} title={detail}>
    <strong className="workspace-row-title">{row.title || 'Untitled meeting'}</strong>
    <span className="workspace-row-time">{new Date(row.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
    {note ? <span className={cx('workspace-row-note', failed && 'is-failed')}>{failed ? <CircleAlert aria-hidden="true" /> : null}{note}</span> : null}
  </button>
}
