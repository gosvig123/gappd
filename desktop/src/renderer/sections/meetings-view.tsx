import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { AppView } from '../lib/app-view'
import type { ConfirmController } from '../components/confirm'
import type { MeetingTab } from '../components/meeting-open-scope'
import { useOpenMeeting } from '../components/meeting-open-scope'
import { MeetingPanel } from '../components/meeting-panel'
import { WorkspaceAgenda } from '../components/workspace-agenda'
import { searchMeetings } from '../lib/meeting-grouping'
import { filterWorkspaceRows, workspaceRows, type AgendaTarget, type WorkspaceRow } from '../lib/meetings-workspace'
import { WorkspaceList } from './workspace-list'
import './meetings-workspace.css'

type Props = { view: AppView; searchRef: React.RefObject<HTMLInputElement | null>; confirm: ConfirmController; initialTab?: MeetingTab | null; onOpenSettings: () => void; onOpenCalendarSettings: () => void }

export function MeetingsView({ view, searchRef, confirm, initialTab, onOpenSettings, onOpenCalendarSettings }: Props) {
  const [query, setQuery] = useState('')
  const [agenda, setAgenda] = useState<AgendaTarget | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const openMeeting = useOpenMeeting(view.actions.openMeeting)
  const rows = useWorkspaceRows(view, query)
  const close = () => { setAgenda(null); view.actions.closeMeeting(); requestAnimationFrame(() => (trigger.current?.isConnected ? trigger.current : searchRef.current)?.focus()) }
  const select = (row: WorkspaceRow, button: HTMLButtonElement) => {
    trigger.current = button; setQuery('')
    if (row.kind === 'meeting') { setAgenda(null); openMeeting(row.meeting.id) }
    else { view.actions.closeMeeting(); setAgenda(row.target) }
  }
  useEffect(() => { if (view.selectedMeetingId) setAgenda(null) }, [view.selectedMeetingId])
  const selectedKey = view.selectedMeetingId ? `meeting:${view.selectedMeetingId}` : agenda ? `agenda:${agenda.draftKey}` : null
  return <div className={`meetings-workspace ${selectedKey ? 'has-selection' : ''} ${query.trim() ? 'is-searching' : ''}`}>
    <WorkspaceHeader view={view} query={query} setQuery={setQuery} searchRef={searchRef} onOpenCalendarSettings={onOpenCalendarSettings} />
    <div className="workspace-columns"><div className="workspace-list ui-scroll"><WorkspaceList {...rows} selectedKey={selectedKey} searching={Boolean(query.trim())} onSelect={select} /></div>
      {selectedKey ? <div className="workspace-content">{view.selectedMeetingId ? <MeetingPanel view={{ ...view, actions: { ...view.actions, closeMeeting: close } }} confirm={confirm} initialTab={initialTab} onOpenSettings={onOpenSettings} /> : agenda ? <WorkspaceAgenda target={agenda} view={view} onClose={close} onOpenSettings={onOpenSettings} /> : null}</div> : null}
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
  }, [view.meetings, view.meetingDetails, view.meetingEvents, view.calendar, view.drafts, query, now])
}

function WorkspaceHeader({ view, query, setQuery, searchRef, onOpenCalendarSettings }: Pick<Props, 'view' | 'searchRef' | 'onOpenCalendarSettings'> & { query: string; setQuery: (value: string) => void }) {
  return <header className="workspace-head"><div className="workspace-heading"><h1 className="ui-title">Meetings</h1><div className="workspace-calendar-actions"><button type="button" className="app-link" disabled={Boolean(view.calendarBusy) || !view.calendar?.connections.length} onClick={() => void view.actions.syncAllCalendars()}>{view.calendarBusy ? 'Refreshing…' : 'Refresh calendars'}</button><button type="button" className="app-link" onClick={onOpenCalendarSettings}>Calendar settings</button></div></div>
    {view.calendarError ? <p className="app-error" role="alert">{view.calendarError}</p> : null}
    <label className="app-search workspace-search"><Search aria-hidden="true" /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Meetings, events, and Agenda topics" aria-label="Search Meetings, events, and Agenda topics" />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden="true" /></button> : <kbd>⌘F</kbd>}</label>
  </header>
}
