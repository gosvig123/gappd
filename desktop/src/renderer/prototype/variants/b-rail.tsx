import { useRef, useState } from 'react'
import { CloseIcon, SearchIcon } from '../../components/icons'
import type { MeetingListItem } from '../../../shared/contracts'
import { EmptyState } from '../../components/ui'
import type { PrototypeView } from '../contract'
import { groupByDate, searchHitLine, searchMeetings, type SearchHit } from '../grouping'
import { useUndo, type UndoController } from '../proto-dialog'
import { MeetingRow, type MeetingRowProps } from './b-row'

const UNDO_MS = 7000

/**
 * The rail is the reason this variant exists: it stays mounted for the life of
 * the app, so list scroll position, the search query, and the highlight survive
 * opening and closing a Meeting.
 */
export function MeetingRail({ view, query, onQueryChange, searchRef }: { view: PrototypeView; query: string; onQueryChange: (value: string) => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const undo = useUndo(UNDO_MS)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [highlight, setHighlight] = useState<string | null>(null)
  const timers = useRef(new Map<string, number>())
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const term = query.trim()
  const listed = view.meetings.filter((meeting) => !hidden.has(meeting.id))
  const hits = searchMeetings(listed, view.meetingDetails, term)
  const ordered: MeetingListItem[] = term ? hits.map((hit) => hit.meeting) : groupByDate(listed).flatMap((group) => group.meetings)
  const commitDelete = deferredDelete(view, setHidden, timers, undo)
  const handleKey = railKeys(ordered, highlight, setHighlight, rowRefs, view)
  const rowProps = rowPropsFor(view, { highlight, pendingId, setHighlight, setPendingId, commitDelete, rowRefs })
  return (
    <aside className="vb-rail" aria-label="Meetings">
      <RailSearch searchRef={searchRef} query={query} onQueryChange={onQueryChange} />
      <div className="vb-rail-list proto-scroll" role="group" aria-label="Meeting list" tabIndex={0} onKeyDown={handleKey}>
        <RailList term={term} listed={listed} hits={hits} grouped={groupByDate(listed)} rowProps={rowProps} />
      </div>
      <RailFooter view={view} count={listed.length} />
      {undo.toast}
    </aside>
  )
}

/** Arrow keys walk the flattened order, so keyboard order matches what is on screen. */
function railKeys(ordered: MeetingListItem[], highlight: string | null, setHighlight: (id: string) => void, rowRefs: React.RefObject<Map<string, HTMLButtonElement>>, view: PrototypeView) {
  return (event: React.KeyboardEvent) => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (delta) {
      event.preventDefault()
      const index = ordered.findIndex((meeting) => meeting.id === highlight)
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, (index < 0 ? -delta : index) + delta))]
      if (!next) return
      setHighlight(next.id)
      rowRefs.current.get(next.id)?.scrollIntoView({ block: 'nearest' })
    }
    if (event.key === 'Enter' && highlight) { event.preventDefault(); view.actions.openMeeting(highlight) }
  }
}

type RowState = { highlight: string | null; pendingId: string | null; setHighlight: (id: string) => void; setPendingId: (id: string | null) => void; commitDelete: (meeting: MeetingListItem) => void; rowRefs: React.RefObject<Map<string, HTMLButtonElement>> }

function rowPropsFor(view: PrototypeView, state: RowState) {
  return (meeting: MeetingListItem, reason?: string): MeetingRowProps => ({
    meeting,
    open: view.selectedMeetingId === meeting.id,
    highlighted: state.highlight === meeting.id,
    pending: state.pendingId === meeting.id,
    reason,
    onOpen: () => view.actions.openMeeting(meeting.id),
    onHighlight: () => state.setHighlight(meeting.id),
    onRequestDelete: () => state.setPendingId(meeting.id),
    onCancelDelete: () => state.setPendingId(null),
    onConfirmDelete: () => { state.setPendingId(null); state.commitDelete(meeting) },
    register: (element) => { if (element) state.rowRefs.current.set(meeting.id, element); else state.rowRefs.current.delete(meeting.id) },
  })
}

function RailSearch({ searchRef, query, onQueryChange }: { searchRef: React.RefObject<HTMLInputElement | null>; query: string; onQueryChange: (value: string) => void }) {
  return (
    <div className="vb-rail-search" data-page-search-ignore>
      <SearchIcon aria-hidden="true" />
      <input ref={searchRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search meetings, people, transcripts" aria-label="Search meetings" />
      {query ? <button type="button" aria-label="Clear search" onClick={() => onQueryChange('')}><CloseIcon aria-hidden="true" /></button> : <kbd>⌘F</kbd>}
    </div>
  )
}

function RailList({ term, listed, hits, grouped, rowProps }: { term: string; listed: MeetingListItem[]; hits: SearchHit[]; grouped: ReturnType<typeof groupByDate>; rowProps: (meeting: MeetingListItem, reason?: string) => MeetingRowProps }) {
  if (!term && !listed.length) return <EmptyState className="vb-rail-empty">No meetings yet. Press Record to capture the next one.</EmptyState>
  if (!term) return <>{grouped.map((group) => (
    <section key={group.key} className="vb-group" aria-label={group.title}>
      <h2 className="vb-group-head">{group.title}<span>{group.meetings.length}</span></h2>
      <ul className="vb-rows">{group.meetings.map((meeting) => <MeetingRow key={meeting.id} {...rowProps(meeting)} />)}</ul>
    </section>
  ))}</>
  if (!hits.length) return <EmptyState className="vb-rail-empty">No Meeting matches “{term}”.</EmptyState>
  return <ul className="vb-rows">{hits.map((hit) => <MeetingRow key={hit.meeting.id} {...rowProps(hit.meeting, searchHitLine(hit))} />)}</ul>
}

function RailFooter({ view, count }: { view: PrototypeView; count: number }) {
  return (
    <footer className="vb-rail-foot">
      <span className={view.canStop ? 'vb-foot-dot is-live' : 'vb-foot-dot'} aria-hidden="true" />
      <span>{recordingLine(view)}</span>
      <span className="vb-foot-count">{count}</span>
    </footer>
  )
}

function recordingLine(view: PrototypeView): string {
  if (view.recording.status === 'recording') return `Recording${view.recording.title ? `: ${view.recording.title}` : ''}`
  if (view.recording.status === 'stopping') return 'Finishing recording…'
  if (view.recording.status === 'error') return view.recording.error ?? 'Recording failed'
  const processing = view.meetings.some((meeting) => meeting.status.processing.state === 'processing')
  return processing ? 'Processing a Meeting' : 'Ready to record'
}

/**
 * Delete is deferred, not faked: the row disappears at once, the real deletion
 * runs after the undo window, and Undo cancels the timer so nothing is lost.
 */
function deferredDelete(view: PrototypeView, setHidden: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void, timers: React.RefObject<Map<string, number>>, undo: UndoController) {
  return (meeting: MeetingListItem) => {
    timers.current.set(meeting.id, window.setTimeout(() => {
      timers.current.delete(meeting.id)
      void view.actions.deleteMeeting(meeting.id)
    }, UNDO_MS))
    setHidden((current) => new Set([...current, meeting.id]))
    undo.offer(`Deleted “${meeting.title || 'Untitled meeting'}”`, () => {
      const pending = timers.current.get(meeting.id)
      if (pending) window.clearTimeout(pending)
      timers.current.delete(meeting.id)
      setHidden((current) => { const next = new Set(current); next.delete(meeting.id); return next })
    })
  }
}
