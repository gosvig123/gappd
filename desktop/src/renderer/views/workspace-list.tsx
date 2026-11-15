import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import type { WorkspaceRow } from '../lib/meetings-workspace'
import { artifactNote } from '../lib/app-view'
import { dayLabel } from '../lib/meeting-grouping'
import { meetingFailed, meetingHasWork, meetingProgressLabel } from '../components/meeting/progress'
import { cx } from '../components/ui'

type Props = { upcoming: WorkspaceRow[]; history: WorkspaceRow[]; selectedKey: string | null; searching: boolean; calendarHint?: ReactNode; now: Date; onSelect: (row: WorkspaceRow, trigger: HTMLButtonElement) => void }
type RowProps = Pick<Props, 'selectedKey' | 'onSelect' | 'now'>

/** The Meetings home: the next Calendar event first, then every Meeting by day. */
export function WorkspaceList({ upcoming, history, selectedKey, searching, calendarHint, now, onSelect }: Props) {
  const rows = { selectedKey, onSelect, now }
  if (searching) return <section aria-label="Search results"><DayGroups rows={[...upcoming, ...history]} {...rows} /></section>
  const [next, ...later] = upcoming
  return <>
    <section className="workspace-next" aria-label="Next up"><h2>Next up</h2>{next ? <WorkspaceRowButton row={next} next {...rows} /> : <div className="app-block-note workspace-next-empty"><p>No upcoming Calendar events. You can still record a Meeting.</p>{calendarHint}</div>}
      {later.length ? <details open={later.some(row => row.key === selectedKey)}><summary>{later.length} more upcoming</summary><DayGroups rows={later} {...rows} /></details> : null}
    </section>
    <section className="workspace-history" aria-label="Meeting history"><h2>History</h2>{history.length ? <DayGroups rows={history} {...rows} /> : <p className="app-block-note">No Meetings yet. Press Record to capture your first Meeting.</p>}</section>
  </>
}

/** Rows under "Today", "Yesterday", or a full date, so each row shows only its time. */
function DayGroups({ rows, ...props }: RowProps & { rows: WorkspaceRow[] }) {
  if (!rows.length) return <p className="app-block-note">No matching Meetings or events.</p>
  const days = new Map<string, WorkspaceRow[]>()
  for (const row of rows) days.set(dayLabel(row.start), [...(days.get(dayLabel(row.start)) ?? []), row])
  return <>{[...days].map(([day, items]) => <div key={day} className="workspace-day"><h3>{day}</h3>{items.map(row => <WorkspaceRowButton key={row.key} row={row} {...props} />)}</div>)}</>
}

function WorkspaceRowButton({ row, next = false, selectedKey, onSelect, now }: RowProps & { row: WorkspaceRow; next?: boolean }) {
  const meeting = row.kind === 'meeting' ? row.meeting : null
  const failed = Boolean(meeting && meetingFailed(meeting))
  const working = Boolean(meeting && meetingHasWork(meeting))
  const recording = meeting?.status.state === 'recording'
  // Only unusual states get a label; a finished Meeting or a planned event stays quiet.
  const note = row.kind === 'meeting' ? (failed ? 'Failed' : working ? meetingProgressLabel(row.meeting) : artifactNote(row.meeting)) : plannedNote(row, now, next)
  const detail = meeting ? undefined : 'Calendar event; not recorded'
  return <button type="button" className={cx('workspace-row', next && 'is-next')} data-workspace-key={row.key} aria-current={row.key === selectedKey ? 'true' : undefined} onClick={event => onSelect(row, event.currentTarget)} title={detail}>
    <strong className="workspace-row-title">{row.title || 'Untitled meeting'}</strong>
    <span className="workspace-row-time">{new Date(row.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
    {note ? <span className={cx('workspace-row-note', failed && 'is-failed', working && 'is-working', recording && 'is-recording')}>{failed ? <CircleAlert aria-hidden="true" /> : working ? <span className="workspace-row-pulse" aria-hidden="true" /> : null}{note}</span> : null}
  </button>
}

/** "Now" for an event under way, "Agenda" for a past event kept for its Agenda, the day for the next event. */
function plannedNote(row: Extract<WorkspaceRow, { kind: 'planned' }>, now: Date, next: boolean): string | null {
  if (new Date(row.end).getTime() < now.getTime()) return 'Agenda'
  if (new Date(row.start).getTime() <= now.getTime()) return 'Now'
  return next ? dayLabel(row.start) : null
}
