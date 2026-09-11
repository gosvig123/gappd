import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import type { AppView } from '../lib/app-view'
import { buildAlerts, type AlertItem } from '../lib/alerts'
import { CalendarView } from '../sections/calendar-view'
import { MeetingsView } from '../sections/meetings-view'
import { PeopleView } from '../sections/people-view'
import { TodayView } from '../sections/today-view'
import { AppSidebar, sectionCounts, type SectionKey } from './app-sidebar'
import { useConfirm } from './confirm'
import { MeetingLayover } from './meeting-layover'
import { OpenMeetingScope, type MeetingTab, type OpenMeeting } from './meeting-open-scope'
import { NotificationStack, useMeetingReadyNotices } from './notifications'
import { PageSearch } from './page-search'
import { RecordBar } from './record-bar'
import { SettingsDialog } from './settings-dialog'
import { Button } from './ui'
import '../app.css'
import '../sections/sections.css'
import './atoms.css'
import './confirm.css'
import './meeting-layover.css'
import './notifications.css'
import './record-bar.css'

/**
 * The application shell: a persistent sidebar swaps the main area between four
 * sections, recording lives in the main toolbar, and one alert model feeds a
 * single banner plus a corner notification stack.
 */
export function AppShell({ view }: { view: AppView }) {
  const [section, setSection] = useState<SectionKey>('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wantsSearch, setWantsSearch] = useState(false)
  const [pendingTab, setPendingTab] = useState<MeetingTab | null>(null)
  const [notices, dismissNotice] = useMeetingReadyNotices(view.meetings)
  const searchRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const alerts = buildAlerts(view)
  const blocking = alerts.filter((alert) => alert.kind === 'blocking')
  const transient = alerts.filter((alert) => alert.kind !== 'blocking')
  const focusMeetingsSearch = useCallback(() => { setSection('meetings'); setWantsSearch(true) }, [])
  const openMeeting = useCallback<OpenMeeting>((id, tab) => { setPendingTab(tab ?? null); view.actions.openMeeting(id) }, [view.actions])
  useSearchShortcut(focusMeetingsSearch)
  usePendingSearchFocus(wantsSearch, section, searchRef, () => setWantsSearch(false))
  return (
    <div className="app-shell">
      <AppSidebar section={section} counts={sectionCounts(view)} onSelect={setSection} onOpenSettings={() => setSettingsOpen(true)} />
      <main className="app-main">
        <RecordBar view={view} />
        <BlockingBanner alerts={blocking} />
        <div className="app-scroll ui-scroll">
          <OpenMeetingScope open={openMeeting}>
            {section === 'today' ? <TodayView view={view} onOpenMeetings={() => setSection('meetings')} onOpenCalendar={() => setSection('calendar')} /> : null}
            {section === 'meetings' ? <MeetingsView view={view} searchRef={searchRef} confirm={confirm} /> : null}
            {section === 'calendar' ? <CalendarView view={view} confirm={confirm} onOpenSettings={() => setSettingsOpen(true)} /> : null}
            {section === 'people' ? <PeopleView view={view} /> : null}
          </OpenMeetingScope>
        </div>
      </main>
      <NotificationStack alerts={transient} notices={notices} onDismissAlert={view.actions.dismissAlert} onDismissNotice={dismissNotice} onOpenMeeting={view.actions.openMeeting} />
      {view.selectedMeetingId ? <MeetingLayover view={view} confirm={confirm} initialTab={pendingTab} onOpenSettings={() => setSettingsOpen(true)} /> : null}
      {settingsOpen ? <SettingsDialog view={view} onClose={() => setSettingsOpen(false)} /> : null}
      {confirm.dialog}
      <PageSearch />
    </div>
  )
}

function BlockingBanner({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) return null
  return (
    <div className="app-blocking" role="alert">
      <CircleAlert aria-hidden="true" />
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id}>
            <div><strong>{alert.title}</strong>{alert.detail ? <span>{alert.detail}</span> : null}</div>
            {alert.actionLabel && alert.run ? <Button variant="primary" className="compact-action" onClick={alert.run}>{alert.actionLabel}</Button> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Cmd/Ctrl+F reaches Meeting search, which is what the app searches, not the DOM. */
function useSearchShortcut(activate: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      activate()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activate])
}

function usePendingSearchFocus(wantsSearch: boolean, section: SectionKey, ref: React.RefObject<HTMLInputElement | null>, done: () => void): void {
  useEffect(() => {
    if (!wantsSearch || section !== 'meetings') return
    ref.current?.focus()
    ref.current?.select()
    done()
  }, [wantsSearch, section, ref, done])
}
