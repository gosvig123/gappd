import { List, Settings as SettingsIcon, Sun, Users } from 'lucide-react'
import type { CalendarSnapshot } from '../../shared/calendar-contract'
import type { AppView } from '../lib/app-view'
import { workspaceRows } from '../lib/meetings-workspace'

const SECTIONS = [
  { key: 'today', label: 'Today', Icon: Sun },
  { key: 'meetings', label: 'Meetings', Icon: List },
  { key: 'people', label: 'People', Icon: Users },
] as const

export type SectionKey = (typeof SECTIONS)[number]['key']

export function AppSidebar({ section, counts, onSelect, onOpenSettings }: { section: SectionKey; counts: Record<SectionKey, number>; onSelect: (key: SectionKey) => void; onOpenSettings: () => void }) {
  return (
    <aside className="app-sidebar">
      <div className="app-brand"><span className="app-mark" aria-hidden="true">G</span><span className="app-brand-name">Gappd</span></div>
      <nav className="app-nav" aria-label="Sections">
        {SECTIONS.map((item) => (
          <button key={item.key} type="button" aria-label={item.label} className={section === item.key ? 'app-nav-item is-active' : 'app-nav-item'} aria-current={section === item.key ? 'page' : undefined} onClick={() => onSelect(item.key)}>
            <item.Icon aria-hidden="true" />
            <span>{item.label}</span>
            <span className="app-nav-count">{counts[item.key]}</span>
          </button>
        ))}
      </nav>
      <div className="app-sidebar-foot">
        <button type="button" className="app-nav-item" aria-label="Settings" onClick={onOpenSettings}><SettingsIcon aria-hidden="true" /><span>Settings</span></button>
      </div>
    </aside>
  )
}

export function sectionCounts(view: AppView): Record<SectionKey, number> {
  const rows = workspaceRows(view)
  return {
    today: todayEventCount(view.calendar),
    meetings: rows.upcoming.length + rows.history.length,
    people: view.people.length,
  }
}

function todayEventCount(calendar: CalendarSnapshot | null, now = new Date()): number {
  if (!calendar) return 0
  return calendar.events.filter((event) => new Date(event.start).toDateString() === now.toDateString()).length
}
