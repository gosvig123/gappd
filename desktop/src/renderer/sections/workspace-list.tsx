import { CalendarDays, FileText, Mic } from 'lucide-react'
import type { WorkspaceRow } from '../lib/meetings-workspace'
import { artifactLine, statusLabel } from '../lib/app-view'

type Props = { upcoming: WorkspaceRow[]; history: WorkspaceRow[]; selectedKey: string | null; searching: boolean; onSelect: (row: WorkspaceRow, trigger: HTMLButtonElement) => void }

export function WorkspaceList({ upcoming, history, selectedKey, searching, onSelect }: Props) {
  const rows = { selectedKey, onSelect }
  if (searching) return <section aria-label="Search results"><RowList rows={[...upcoming, ...history]} {...rows} /></section>
  return <>
    <section className="workspace-next" aria-label="Next up"><h2>Next up</h2>{upcoming[0] ? <WorkspaceRowButton row={upcoming[0]} {...rows} /> : <p className="app-block-note">No upcoming Calendar events. You can still record a Meeting.</p>}
      {upcoming.length > 1 ? <details open={upcoming.slice(1).some(row => row.key === selectedKey)}><summary>{upcoming.length - 1} more upcoming</summary><RowList rows={upcoming.slice(1)} {...rows} /></details> : null}
    </section>
    <section className="workspace-history" aria-label="Meeting history"><h2>History</h2>{history.length ? <RowList rows={history} {...rows} /> : <p className="app-block-note">No Meetings or Saved Agenda drafts yet. Press Record to capture your first Meeting.</p>}</section>
  </>
}

function RowList({ rows, ...props }: Pick<Props, 'selectedKey' | 'onSelect'> & { rows: WorkspaceRow[] }) {
  return <div>{rows.map(row => <WorkspaceRowButton key={row.key} row={row} {...props} />)}{!rows.length ? <p className="app-block-note">No matching Meetings, events, or Agenda topics.</p> : null}</div>
}

function WorkspaceRowButton({ row, selectedKey, onSelect }: Pick<Props, 'selectedKey' | 'onSelect'> & { row: WorkspaceRow }) {
  const Icon = row.kind === 'meeting' ? Mic : row.kind === 'planned' ? CalendarDays : FileText
  const state = row.kind === 'meeting' ? statusLabel(row.meeting) : row.kind === 'planned' ? 'Planned' : 'Saved draft'
  const detail = row.kind === 'meeting' ? artifactLine(row.meeting) : row.kind === 'planned' ? 'Calendar event; not recorded' : 'Saved Agenda draft; no recording'
  return <button type="button" className="workspace-row" data-workspace-key={row.key} aria-current={row.key === selectedKey ? 'true' : undefined} onClick={event => onSelect(row, event.currentTarget)} title={detail}>
    <Icon aria-hidden="true" /><span className="workspace-row-copy"><strong>{row.title || 'Untitled meeting'}</strong><span>{new Date(row.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span><span className={`workspace-row-state is-${row.kind}`}>{state}</span>
  </button>
}
