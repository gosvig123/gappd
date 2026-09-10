import { useEffect, useRef, useState } from 'react'
import { CloseIcon, GearIcon, MicIcon, SearchIcon, SquareIcon } from '../../components/icons'
import { Button, StatusPill } from '../../components/ui'
import { SettingsView } from '../../routes/settings-view'
import { buildAlerts, type AlertItem, type PrototypeView } from '../contract'
import { useConfirm, type ConfirmController } from '../proto-dialog'
import type { VariantProps } from '../variants'
import { ReadingDetail } from './a-detail'
import { ReadingIndex } from './a-index'
import './variant-a.css'
import './a-reading.css'

/**
 * Variant A — "Reading Room".
 * One centred column. Search is the primary affordance, alerts collapse into a
 * single rail, and an opened Meeting replaces the index like a document.
 */
export default { key: 'a', name: 'Reading Room', tagline: 'One calm column, search first, document reading', Component: VariantA }

function VariantA({ view }: VariantProps) {
  const [query, setQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const alerts = buildAlerts(view)
  useSearchShortcut(searchRef)
  useEscapeToClose(view.selectedMeetingId, view.actions.closeMeeting)
  return (
    <div className="va-shell">
      <header className="va-topbar">
        <Brand searchRef={searchRef} query={query} onQueryChange={setQuery} />
        <div className="va-topbar-actions">
          <VaRecord view={view} />
          <Button className="va-icon-button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}><GearIcon aria-hidden="true" /></Button>
        </div>
      </header>
      <AlertRail alerts={alerts} open={railOpen} onToggle={() => setRailOpen((value) => !value)} onDismiss={view.actions.dismissAlert} />
      <main className="va-main proto-scroll">
        {view.selectedMeetingId ? (
          <ReadingDetail view={view} confirm={confirm} />
        ) : (
          <ReadingIndex view={view} query={query} onQueryChange={setQuery} onOpenSettings={() => setSettingsOpen(true)} confirm={confirm} />
        )}
      </main>
      {settingsOpen ? <SettingsPanel view={view} onClose={() => setSettingsOpen(false)} /> : null}
      {confirm.dialog}
    </div>
  )
}

function Brand({ searchRef, query, onQueryChange }: { searchRef: React.RefObject<HTMLInputElement | null>; query: string; onQueryChange: (value: string) => void }) {
  return (
    <div className="va-brand">
      <span className="va-mark" aria-hidden="true">G</span>
      <label className="va-search" data-page-search-ignore>
        <SearchIcon aria-hidden="true" />
        <input ref={searchRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search meetings, people, transcripts" aria-label="Search meetings" />
        {query ? <button type="button" aria-label="Clear search" onClick={() => onQueryChange('')}><CloseIcon aria-hidden="true" /></button> : <kbd>⌘F</kbd>}
      </label>
    </div>
  )
}

function VaRecord({ view }: { view: PrototypeView }) {
  const recording = view.recording.status === 'recording' || view.recording.status === 'stopping'
  return (
    <div className="va-record">
      <label className="va-device" title="Audio input">
        <MicIcon aria-hidden="true" />
        <select value={view.device} onChange={(event) => view.actions.setDevice(Number(event.target.value))} disabled={recording} aria-label="Audio input">
          {view.devices.map((device) => <option key={device.index} value={device.index}>{device.name}</option>)}
        </select>
      </label>
      <button type="button" className={recording ? 'va-record-button is-recording' : 'va-record-button'} disabled={recording ? !view.canStop : !view.canStart} onClick={() => (recording ? view.actions.stop() : view.actions.start())} title={view.canStart || recording ? undefined : 'Connect an audio input to record'}>
        {recording ? <SquareIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        {view.recording.status === 'stopping' ? 'Stopping…' : recording ? 'Stop' : 'Record'}
      </button>
    </div>
  )
}

function AlertRail({ alerts, open, onToggle, onDismiss }: { alerts: AlertItem[]; open: boolean; onToggle: () => void; onDismiss: (id: string) => void }) {
  if (!alerts.length) return null
  const blocking = alerts.filter((alert) => alert.kind === 'blocking')
  const rest = alerts.filter((alert) => alert.kind !== 'blocking')
  const lead = blocking[0] ?? rest[0]
  if (!lead) return null
  const extra = alerts.length - 1
  return (
    <section className={open ? 'va-rail is-open' : 'va-rail'} aria-label="Status">
      <div className="va-rail-lead">
        <StatusPill tone={lead.kind === 'blocking' ? 'failed' : lead.kind === 'attention' ? 'stopping' : 'idle'}>{lead.kind === 'blocking' ? 'Action needed' : lead.kind === 'attention' ? 'Attention' : 'Ready'}</StatusPill>
        <strong>{lead.title}</strong>
        {extra > 0 ? <button type="button" className="va-rail-toggle" aria-expanded={open} onClick={onToggle}>{open ? 'Hide' : `${extra} more`}</button> : null}
        {extra === 0 && lead.actionLabel ? <button type="button" className="va-rail-toggle" onClick={lead.run}>{lead.actionLabel}</button> : null}
      </div>
      {open ? (
        <ul className="va-rail-list">
          {alerts.map((alert) => (
            <li key={alert.id} className={`va-rail-item ${alert.kind}`}>
              <div><strong>{alert.title}</strong>{alert.detail ? <p>{alert.detail}</p> : null}</div>
              <div className="va-rail-item-actions">
                {alert.actionLabel && alert.run ? <Button className="compact-action" onClick={alert.run}>{alert.actionLabel}</Button> : null}
                {alert.kind === 'blocking' ? null : <button type="button" className="va-rail-dismiss" aria-label={`Dismiss ${alert.title}`} onClick={() => onDismiss(alert.id)}>×</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function SettingsPanel({ view, onClose }: { view: PrototypeView; onClose: () => void }) {
  useEscapeToClose('open', onClose)
  return (
    <div className="va-sheet-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="va-sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="va-sheet-head">
          <h2>Settings</h2>
          <button type="button" className="va-sheet-close" aria-label="Close settings" onClick={onClose}><CloseIcon aria-hidden="true" /></button>
        </div>
        <div className="va-sheet-body proto-scroll">
          <SettingsView
            language={view.language}
            onLanguageChange={view.actions.setLanguage}
            localAI={{ status: view.runtime, loading: view.runtimeLoading, busy: view.runtimeBusy, onRepair: () => view.actions.repairRuntime('repair') }}
            calendar={view.calendarController}
            developerDebugEnabled={false}
          />
        </div>
      </aside>
    </div>
  )
}

function useSearchShortcut(ref: React.RefObject<HTMLInputElement | null>): void {
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

function useEscapeToClose(active: string | null, close: () => void): void {
  useEffect(() => {
    if (!active) return undefined
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, close])
}

export type { ConfirmController }
