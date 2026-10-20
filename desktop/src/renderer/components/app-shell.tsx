import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppView } from '../lib/app-view'
import { buildAlerts } from '../lib/alerts'
import { MeetingsView } from '../views/meetings'
import { PeopleView } from '../views/people'
import { TodayView } from '../views/today'
import { AppSidebar, type SectionKey } from './app-sidebar'
import { useConfirm } from './confirm'
import { NotificationStack, useMeetingReadyNotices } from './notifications'
import { PageSearch } from './page-search'
import { RecordBar } from './record-bar'
import { SettingsDialog } from './settings/dialog'
import { SetupChecklist } from './setup-checklist'
import '../app.css'
import '../views/views.css'
import './atoms.css'
import './confirm.css'
import './meeting/panel.css'
import './notifications.css'
import './record-bar.css'

/** All Meeting links lead to the same reading workspace. Recording stays global. */
export function AppShell({ view }: { view: AppView }) {
  const shell = useShellController(view)
  const routedView = { ...view, actions: { ...view.actions, openMeeting: shell.openMeeting, openSettings: shell.setSettingsCategory } }
  return <div className="app-shell">
    <AppSidebar section={shell.section} onSelect={shell.setSection} onOpenSettings={() => shell.setSettingsCategory('General')} />
    <ShellMain view={routedView} shell={shell} />
    <NotificationStack alerts={shell.alerts} notices={shell.notices} onDismissAlert={view.actions.dismissAlert} onDismissNotice={shell.dismissNotice} onOpenMeeting={shell.openMeeting} />
    {shell.settingsCategory ? <SettingsDialog view={routedView} initialCategory={shell.settingsCategory} onClose={() => shell.setSettingsCategory(null)} /> : null}
    {shell.confirm.dialog}<PageSearch />
  </div>
}

function useShellController(view: AppView) {
  const [section, setSection] = useState<SectionKey>('today')
  const [settingsCategory, setSettingsCategory] = useState<string | null>(null)
  const [wantsSearch, setWantsSearch] = useState(false)
  const [notices, dismissNotice] = useMeetingReadyNotices(view.meetings)
  const searchRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const alerts = buildAlerts(view)
  const focusMeetingsSearch = useCallback(() => { setSection('meetings'); setWantsSearch(true) }, [])
  const openMeeting = useCallback((id: string) => { setSection('meetings'); view.actions.openMeeting(id) }, [view.actions])
  useSearchShortcut(focusMeetingsSearch)
  usePendingSearchFocus(wantsSearch, section, searchRef, () => setWantsSearch(false))
  return { section, setSection, settingsCategory, setSettingsCategory, notices, dismissNotice, searchRef, confirm, alerts, openMeeting }
}

function ShellMain({ view, shell }: { view: AppView; shell: ReturnType<typeof useShellController> }) {
  return <main className="app-main"><RecordBar view={view} /><SetupChecklist view={view} />
    <div className={`app-scroll ui-scroll ${shell.section === 'meetings' ? 'is-workspace' : ''}`}>
      {shell.section === 'today' ? <TodayView view={view} onOpenMeetings={() => shell.setSection('meetings')} /> : null}
      {shell.section === 'meetings' ? <MeetingsView view={view} searchRef={shell.searchRef} confirm={shell.confirm} /> : null}
      {shell.section === 'people' ? <PeopleView view={view} /> : null}
    </div>
  </main>
}

/** Cmd/Ctrl+F searches local Meetings and Calendar events. */
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
