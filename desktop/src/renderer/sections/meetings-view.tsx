import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, Trash2, X } from 'lucide-react'
import type { MeetingListItem } from '../../shared/contracts'
import { meetingStatusPillVisible, meetingStatusTone } from '../../shared/meeting-recording-workflow'
import { meetingHasWork } from '../components/meeting-progress'
import { EmptyState, StatusPill, cx } from '../components/ui'
import { artifactLine, statusLabel, type AppView } from '../lib/app-view'
import { meetingDurationLabel, meetingTimeLabel, searchHitLine, searchMeetings } from '../lib/meeting-grouping'
import type { ConfirmController } from '../components/confirm'
import { MeetingAgendaChip } from '../components/agenda-tab'
import { useOpenMeeting } from '../components/meeting-open-scope'

type SortKey = 'time' | 'title'
type Sort = { key: SortKey; direction: 'ascending' | 'descending' }

type MeetingsViewProps = { view: AppView; searchRef: React.RefObject<HTMLInputElement | null>; confirm: ConfirmController }

export function MeetingsView({ view, searchRef, confirm }: MeetingsViewProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'time', direction: 'descending' })
  const hits = useMemo(() => searchMeetings(view.meetings, view.meetingDetails, query), [view.meetings, view.meetingDetails, query])
  const searched = query.trim().length > 0
  const rows = useMemo(() => sortRows(searched ? hits.map((hit) => hit.meeting) : view.meetings, sort), [hits, searched, view.meetings, sort])
  const reasonOf = (id: string) => { const hit = searched ? hits.find((item) => item.meeting.id === id) : undefined; return hit ? searchHitLine(hit) : undefined }
  return (
    <div className="app-stack">
      <header className="app-section-head">
        <p className="ui-eyebrow">Local meeting history</p>
        <h1 className="ui-title">Meetings</h1>
        <p className="app-section-sub">{searched ? `${rows.length} of ${view.meetings.length} Meetings match` : `${view.meetings.length} Meetings · sorted by ${sort.key === 'time' ? 'date' : 'title'}, ${sort.direction === 'ascending' ? 'ascending' : 'descending'}`}</p>
      </header>
      <label className="app-search">
        <Search aria-hidden="true" />
        <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, People, notes, and transcripts" aria-label="Search Meetings" />
        {searched ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden="true" /></button> : <kbd>⌘F</kbd>}
      </label>
      {rows.length ? <MeetingTable rows={rows} view={view} reasonOf={reasonOf} sort={sort} onSort={(key) => setSort((current) => toggleSort(current, key))} confirm={confirm} /> : <EmptyState>{searched ? `No Meeting matches “${query.trim()}”.` : 'No Meetings yet. Press Record to capture the first one.'}</EmptyState>}
    </div>
  )
}

function MeetingTable({ rows, view, reasonOf, sort, onSort, confirm }: { rows: MeetingListItem[]; view: AppView; reasonOf: (id: string) => string | undefined; sort: Sort; onSort: (key: SortKey) => void; confirm: ConfirmController }) {
  return (
    <div className="app-table-wrap">
      <table className="app-table">
        <caption className="ui-visually-hidden">Meeting history with date, title, duration, speakers, and status</caption>
        <thead>
          <tr>
            <SortHeader label="When" column="time" sort={sort} onSort={onSort} />
            <SortHeader label="Meeting" column="title" sort={sort} onSort={onSort} />
            <th scope="col">Duration</th>
            <th scope="col">Speakers</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="ui-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} view={view} reason={reasonOf(meeting.id)} confirm={confirm} />)}
        </tbody>
      </table>
    </div>
  )
}

function SortHeader({ label, column, sort, onSort }: { label: string; column: SortKey; sort: Sort; onSort: (key: SortKey) => void }) {
  const active = sort.key === column
  const Glyph = sort.direction === 'ascending' ? ChevronUp : ChevronDown
  return (
    <th scope="col" aria-sort={active ? sort.direction : 'none'}>
      <button type="button" className={cx('app-sort', active && 'is-active')} onClick={() => onSort(column)}>
        {label}{active ? <Glyph aria-hidden="true" /> : null}
      </button>
    </th>
  )
}

function MeetingRow({ meeting, view, reason, confirm }: { meeting: MeetingListItem; view: AppView; reason?: string; confirm: ConfirmController }) {
  const detail = view.meetingDetails.get(meeting.id)
  const open = useOpenMeeting(view.actions.openMeeting)
  const isOpen = view.selectedMeetingId === meeting.id
  return (
    <tr className={cx('app-row', isOpen && 'is-open')} aria-current={isOpen ? 'true' : undefined}>
      <td className="app-cell-time">{meetingTimeLabel(meeting)}</td>
      <th scope="row" className="app-cell-title">
        <button type="button" className="app-table-open" onClick={() => open(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
        <span className="app-table-sub">
          <span className="app-table-match">{reason ?? artifactLine(meeting)}</span>
          <MeetingAgendaChip view={view} meetingId={meeting.id} onOpen={() => open(meeting.id, 'agenda')} />
        </span>
      </th>
      <td className="app-cell-num">{meetingDurationLabel(meeting)}</td>
      <td className="app-cell-num">{detail ? speakerCountLabel(detail.speakers.length) : '—'}</td>
      <td>{statusCell(meeting)}</td>
      <td className="app-cell-actions">
        {meetingHasWork(meeting) ? null : (
          <button
            type="button"
            className="app-icon-action"
            aria-label={`Delete ${meeting.title || 'meeting'}`}
            onClick={() => confirm.request({ title: 'Delete this Meeting?', body: `Removes the summary, transcript, speaker labels, and audio for “${meeting.title || 'Untitled meeting'}”. This cannot be undone.`, confirmLabel: 'Delete Meeting', tone: 'danger', onConfirm: () => view.actions.deleteMeeting(meeting.id) })}
          ><Trash2 aria-hidden="true" /></button>
        )}
      </td>
    </tr>
  )
}

/** The artifact line already sits under the title, so this column shows only the progress state. */
function statusCell(meeting: MeetingListItem) {
  const tone = meetingStatusPillVisible(meeting.status.state) ? meetingStatusTone(meeting.status.state) : 'idle'
  return <StatusPill tone={tone}>{statusLabel(meeting)}</StatusPill>
}

function speakerCountLabel(count: number): string {
  if (count === 0) return '—'
  return `${count} ${count === 1 ? 'speaker' : 'speakers'}`
}

function sortRows(rows: MeetingListItem[], sort: Sort): MeetingListItem[] {
  const factor = sort.direction === 'ascending' ? 1 : -1
  return [...rows].sort((left, right) => factor * compareRows(left, right, sort.key))
}

function compareRows(left: MeetingListItem, right: MeetingListItem, key: SortKey): number {
  if (key === 'title') return (left.title || '').localeCompare(right.title || '')
  return left.startedAt.localeCompare(right.startedAt)
}

function toggleSort(sort: Sort, key: SortKey): Sort {
  if (sort.key === key) return { key, direction: sort.direction === 'ascending' ? 'descending' : 'ascending' }
  return { key, direction: key === 'title' ? 'ascending' : 'descending' }
}
