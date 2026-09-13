import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import type { AppView } from '../lib/app-view'
import { buildAlerts, type AlertItem } from '../lib/alerts'
import { MeetingsView } from '../sections/meetings-view'
import { PeopleView } from '../sections/people-view'
import { TodayView } from '../sections/today-view'
import { AppSidebar, sectionCounts, type SectionKey } from './app-sidebar'
import { useConfirm } from './confirm'
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
import './meeting-panel.css'
import './notifications.css'
import './record-bar.css'

/** All Meeting links lead to the same reading workspace. Recording stays global. */
export function AppShell({ view }: { view: AppView }) {
  const shell = useShellController(view)
  const routedView = { ...view, actions: { ...view.actions, openMeeting: shell.openMeeting } }
  return <div className="app-shell">
    <AppSidebar section={shell.section} counts={sectionCounts(view)} onSelect={shell.setSection} onOpenSettings={() => shell.setSettingsCategory('General')} />
    <ShellMain view={routedView} shell={shell} />
    <NotificationStack alerts={shell.alerts.filter(alert => alert.kind !== 'blocking')} notices={shell.notices} onDismissAlert={view.actions.dismissAlert} onDismissNotice={shell.dismissNotice} onOpenMeeting={shell.openMeeting} />
    {shell.settingsCategory ? <SettingsDialog view={routedView} initialCategory={shell.settingsCategory} onClose={() => shell.setSettingsCategory(null)} /> : null}
    {shell.confirm.dialog}<PageSearch />
  </div>
}

function useShellController(view: AppView) {
  const [section, setSection] = useState<SectionKey>('today')
  const [settingsCategory, setSettingsCategory] = useState<string | null>(null)
  const [wantsSearch, setWantsSearch] = useState(false)
  const [pendingTab, setPendingTab] = useState<MeetingTab | null>(null)
  const [notices, dismissNotice] = useMeetingReadyNotices(view.meetings)
  const searchRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const alerts = buildAlerts(view)
  const focusMeetingsSearch = useCallback(() => { setSection('meetings'); setWantsSearch(true) }, [])
  const openMeeting = useCallback<OpenMeeting>((id, tab) => { setSection('meetings'); setPendingTab(tab ?? null); view.actions.openMeeting(id) }, [view.actions])
  useSearchShortcut(focusMeetingsSearch)
  usePendingSearchFocus(wantsSearch, section, searchRef, () => setWantsSearch(false))
  return { section, setSection, settingsCategory, setSettingsCategory, pendingTab, notices, dismissNotice, searchRef, confirm, alerts, openMeeting }
}

function ShellMain({ view, shell }: { view: AppView; shell: ReturnType<typeof useShellController> }) {
  return <main className="app-main"><RecordBar view={view} /><BlockingBanner alerts={shell.alerts.filter(alert => alert.kind === 'blocking')} />
    <div className={`app-scroll ui-scroll ${shell.section === 'meetings' ? 'is-workspace' : ''}`}><OpenMeetingScope open={shell.openMeeting}>
      {shell.section === 'today' ? <TodayView view={view} onOpenMeetings={() => shell.setSection('meetings')} onOpenCalendar={() => shell.setSection('meetings')} /> : null}
      {shell.section === 'meetings' ? <MeetingsView view={view} searchRef={shell.searchRef} confirm={shell.confirm} initialTab={shell.pendingTab} onOpenSettings={() => shell.setSettingsCategory('Meeting processing')} onOpenCalendarSettings={() => shell.setSettingsCategory('Connections')} /> : null}
      {shell.section === 'people' ? <PeopleView view={view} /> : null}
    </OpenMeetingScope></div>
  </main>
}

function BlockingBanner({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) return null
  return <div className="app-blocking" role="alert"><CircleAlert aria-hidden="true" /><ul>{alerts.map(alert => <li key={alert.id}><div><strong>{alert.title}</strong>{alert.detail ? <span>{alert.detail}</span> : null}</div>{alert.actionLabel && alert.run ? <Button variant="primary" className="compact-action" onClick={alert.run}>{alert.actionLabel}</Button> : null}</li>)}</ul></div>
}

/** Cmd/Ctrl+F searches local Meetings, Calendar events, and saved Agenda topics. */
function useSearchShortcut(activate: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault(); activate()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activate])
}

function usePendingSearchFocus(wantsSearch: boolean, section: SectionKey, ref: React.RefObject<HTMLInputElement | null>, done: () => void): void {
  useEffect(() => {
    if (!wantsSearch || section !== 'meetings') return
    ref.current?.focus(); ref.current?.select(); done()
  }, [wantsSearch, section, ref, done])
}
