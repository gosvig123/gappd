import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, CircleAlert, List, Settings as SettingsIcon, Sun, Users } from 'lucide-react'
import type { CalendarSnapshot } from '../../../shared/calendar-contract'
import { Button } from '../../components/ui'
import { buildAlerts, type AlertItem, type PrototypeView } from '../contract'
import { useConfirm } from '../proto-dialog'
import type { VariantProps } from '../variants'
import { DeckCalendar } from './c-calendar'
import { DeckMeetings } from './c-meetings'
import { DeckPanel } from './c-panel'
import { DeckPeople } from './c-people'
import { DeckSettings } from './c-settings'
import { DeckToday } from './c-today'
import { DeckToasts, RecordBar } from './c-dock'
import './variant-c.css'
import './c-sections.css'
import './c-panel.css'
import './c-dock.css'

/**
 * Variant C — "Today Deck".
 *
 * A persistent sidebar swaps the whole main area between four sections. Today is
 * the landing surface: the day's calendar drives recording, and Meeting history
 * lives in a sortable table rather than a card grid. Alerts split by severity —
 * only blocking problems get a banner, everything else is a corner toast — and
 * recording lives in the main toolbar so it is always in the same place.
 */
export default { key: 'c', name: 'Today Deck', tagline: 'Agenda-first sidebar with a history table', Component: VariantC }

const SECTIONS = [
  { key: 'today', label: 'Today', Icon: Sun },
  { key: 'meetings', label: 'Meetings', Icon: List },
  { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { key: 'people', label: 'People', Icon: Users },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

function VariantC({ view }: VariantProps) {
  const [section, setSection] = useState<SectionKey>('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wantsSearch, setWantsSearch] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const alerts = buildAlerts(view)
  const blocking = alerts.filter((alert) => alert.kind === 'blocking')
  const transient = alerts.filter((alert) => alert.kind !== 'blocking')
  const focusMeetingsSearch = useCallback(() => { setSection('meetings'); setWantsSearch(true) }, [])
  useSearchShortcut(focusMeetingsSearch)
  usePendingSearchFocus(wantsSearch, section, searchRef, () => setWantsSearch(false))
  return (
    <div className="vc-shell">
      <Sidebar section={section} counts={sectionCounts(view)} onSelect={setSection} onOpenSettings={() => setSettingsOpen(true)} />
      <main className="vc-main">
        <RecordBar view={view} />
        <BlockingBanner alerts={blocking} />
        <div className="vc-scroll proto-scroll">
          {section === 'today' ? <DeckToday view={view} onOpenMeetings={() => setSection('meetings')} onOpenCalendar={() => setSection('calendar')} /> : null}
          {section === 'meetings' ? <DeckMeetings view={view} searchRef={searchRef} confirm={confirm} /> : null}
          {section === 'calendar' ? <DeckCalendar view={view} confirm={confirm} onOpenSettings={() => setSettingsOpen(true)} /> : null}
          {section === 'people' ? <DeckPeople view={view} /> : null}
        </div>
      </main>
      <DeckToasts alerts={transient} onDismiss={view.actions.dismissAlert} />
      {view.selectedMeetingId ? <DeckPanel view={view} confirm={confirm} /> : null}
      {settingsOpen ? <DeckSettings view={view} onClose={() => setSettingsOpen(false)} /> : null}
      {confirm.dialog}
    </div>
  )
}

function Sidebar({ section, counts, onSelect, onOpenSettings }: { section: SectionKey; counts: Record<SectionKey, number>; onSelect: (key: SectionKey) => void; onOpenSettings: () => void }) {
  return (
    <aside className="vc-sidebar">
      <div className="vc-brand"><span className="vc-mark" aria-hidden="true">G</span><span className="vc-brand-name">Gappd</span></div>
      <nav className="vc-nav" aria-label="Sections">
        {SECTIONS.map((item) => (
          <button key={item.key} type="button" className={section === item.key ? 'vc-nav-item is-active' : 'vc-nav-item'} aria-current={section === item.key ? 'page' : undefined} onClick={() => onSelect(item.key)}>
            <item.Icon aria-hidden="true" />
            <span>{item.label}</span>
            <span className="vc-nav-count">{counts[item.key]}</span>
          </button>
        ))}
      </nav>
      <div className="vc-sidebar-foot">
        <button type="button" className="vc-nav-item" onClick={onOpenSettings}><SettingsIcon aria-hidden="true" /><span>Settings</span></button>
      </div>
    </aside>
  )
}

function BlockingBanner({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) return null
  return (
    <div className="vc-blocking" role="alert">
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

function sectionCounts(view: PrototypeView): Record<SectionKey, number> {
  return {
    today: todayEventCount(view.calendar),
    meetings: view.meetings.length,
    calendar: view.calendar?.connections.length ?? 0,
    people: view.people.length,
  }
}

function todayEventCount(calendar: CalendarSnapshot | null, now = new Date()): number {
  if (!calendar) return 0
  return calendar.events.filter((event) => new Date(event.start).toDateString() === now.toDateString()).length
}

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

/** Cmd+F jumps to the Meetings section, so the field has to focus after that render. */
function usePendingSearchFocus(wantsSearch: boolean, section: SectionKey, ref: React.RefObject<HTMLInputElement | null>, done: () => void): void {
  useEffect(() => {
    if (!wantsSearch || section !== 'meetings') return
    ref.current?.focus()
    ref.current?.select()
    done()
  }, [wantsSearch, section, ref, done])
}
