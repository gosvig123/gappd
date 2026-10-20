import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { AppView } from '../lib/app-view'
import type { ConfirmController } from '../components/confirm'
import { MeetingPanel } from '../components/meeting/panel'
import { WorkspaceEvent } from '../components/meeting/workspace-event'
import { searchMeetings } from '../lib/meeting-grouping'
import { filterWorkspaceRows, workspaceRows, type CalendarTarget, type WorkspaceRow } from '../lib/meetings-workspace'
import { WorkspaceList } from './workspace-list'
import './meetings-workspace.css'

const SEARCH_LABEL = 'Search Meetings and events'

type Props = { view: AppView; searchRef: React.RefObject<HTMLInputElement | null>; confirm: ConfirmController }

export function MeetingsView({ view, searchRef, confirm }: Props) {
  const [query, setQuery] = useState('')
  // A narrow window shows either the results or the selection. Choosing a result keeps the query, so typing again shows the results.
  const [browsingResults, setBrowsingResults] = useState(false)
  const search = (value: string) => { setQuery(value); setBrowsingResults(true) }
  const [event, setEvent] = useState<CalendarTarget | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const rows = useWorkspaceRows(view, query)
  const close = () => { setEvent(null); view.actions.closeMeeting(); requestAnimationFrame(() => (trigger.current?.isConnected ? trigger.current : searchRef.current)?.focus()) }
  const select = (row: WorkspaceRow, button: HTMLButtonElement) => {
    trigger.current = button; setBrowsingResults(false)
    if (row.kind === 'meeting') { setEvent(null); view.actions.openMeeting(row.meeting.id) }
    else { view.actions.closeMeeting(); setEvent(row.target) }
  }
  useEffect(() => { if (view.selectedMeetingId) setEvent(null) }, [view.selectedMeetingId])
  const selectedKey = view.selectedMeetingId ? `meeting:${view.selectedMeetingId}` : event ? `event:${event.key}` : null
  return <div className={`meetings-workspace ${selectedKey ? 'has-selection' : ''} ${query.trim() && browsingResults ? 'is-searching' : ''}`}>
    <WorkspaceHeader view={view} query={query} setQuery={search} searchRef={searchRef} />
    <div className="workspace-columns"><div className="workspace-list ui-scroll"><WorkspaceList {...rows} selectedKey={selectedKey} searching={Boolean(query.trim())} onSelect={select} /></div>
      {selectedKey ? <div className="workspace-content">{view.selectedMeetingId ? <MeetingPanel view={{ ...view, actions: { ...view.actions, closeMeeting: close } }} confirm={confirm} /> : event ? <WorkspaceEvent target={event} view={view} onClose={close} /> : null}</div> : null}
    </div>
  </div>
}

function useWorkspaceRows(view: AppView, query: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])
  return useMemo(() => {
    const rows = workspaceRows(view, now)
    const matches = new Set(searchMeetings(view.meetings, view.meetingDetails, query).map(hit => hit.meeting.id))
    return { upcoming: filterWorkspaceRows(rows.upcoming, query, matches), history: filterWorkspaceRows(rows.history, query, matches) }
  }, [view.meetings, view.meetingDetails, view.meetingEvents, view.calendar, query, now])
}

function WorkspaceHeader({ view, query, setQuery, searchRef }: Pick<Props, 'view' | 'searchRef'> & { query: string; setQuery: (value: string) => void }) {
  return <header className="workspace-head"><div className="workspace-heading"><h1 className="ui-title">Meetings</h1></div>
    <label className="app-search workspace-search"><Search aria-hidden="true" /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={SEARCH_LABEL} aria-label={SEARCH_LABEL} />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden="true" /></button> : <kbd>⌘F</kbd>}</label>
  </header>
}
