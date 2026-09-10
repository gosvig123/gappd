import { useEffect, useRef, useState } from 'react'
import { buildAlerts, type PrototypeView } from '../contract'
import type { VariantProps } from '../variants'
import { AlertBar } from './b-alerts'
import { DetailPane } from './b-detail'
import { HomePane } from './b-home'
import { MeetingRail } from './b-rail'
import { SettingsModal } from './b-settings'
import { TopStrip } from './b-topstrip'
import './variant-b.css'

/**
 * Variant B — "Split Console".
 *
 * The list rail never unmounts. Variant A swaps the index out for the reading
 * view, which throws away list scroll position and the search query on every
 * open; here the rail is a permanent left column and only the right pane
 * changes. That is also why search, the record control and the alert surface
 * each exist exactly once in this variant.
 */
export default { key: 'b', name: 'Split Console', tagline: 'Persistent list rail beside a working pane', Component: VariantB }

function VariantB({ view }: VariantProps) {
  const [query, setQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [alertBarOpen, setAlertBarOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const alerts = buildAlerts(view)
  useSearchFocus(searchRef)
  usePaneFocus(paneRef, view.selectedMeetingId)
  return (
    <div className="vb-shell">
      <TopStrip view={view} onOpenSettings={() => setSettingsOpen(true)} />
      <AlertBar alerts={alerts} open={alertBarOpen} onToggle={() => setAlertBarOpen((value) => !value)} onDismiss={view.actions.dismissAlert} />
      <div className="vb-body">
        <MeetingRail view={view} query={query} onQueryChange={setQuery} searchRef={searchRef} />
        <div ref={paneRef} className="vb-pane proto-scroll" tabIndex={-1} aria-label="Meeting workspace">
          {view.selectedMeetingId ? <DetailPane view={view} /> : <HomePane view={view} onOpenSettings={() => setSettingsOpen(true)} />}
        </div>
      </div>
      {settingsOpen ? <SettingsModal view={view} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}

function useSearchFocus(ref: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      ref.current?.focus()
      ref.current?.select()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [ref])
}

/** Moves focus into the pane when the open Meeting changes, but not on first paint. */
function usePaneFocus(ref: React.RefObject<HTMLDivElement | null>, meetingId: string | null): void {
  const previous = useRef(meetingId)
  useEffect(() => {
    if (previous.current === meetingId) return
    previous.current = meetingId
    ref.current?.focus()
  }, [meetingId, ref])
}
