// Throwaway: three merged Meetings/Calendar layouts on the renderer URL via ?variant=A|B|C.
import { useEffect, useState } from 'react'
import { List, Sun, Users, Settings, Search } from 'lucide-react'
import { demoEntries, variantNames, type Variant } from './meetings-calendar-prototype-data'
import { NextHistory, EntryDetails, UpcomingPast, OneList } from './meetings-calendar-prototype-views'
import './meetings-calendar-prototype.css'

function readVariant(): Variant {
  const value = new URLSearchParams(location.search).get('variant')
  return value === 'B' || value === 'C' ? value : 'A'
}

function useVariant() {
  const [variant, setVariant] = useState(readVariant)
  const cycle = (step: number) => {
    const keys = Object.keys(variantNames) as Variant[]
    const next = keys[(keys.indexOf(variant) + step + keys.length) % keys.length]
    const url = new URL(location.href); url.searchParams.set('variant', next)
    history.replaceState(null, '', url); setVariant(next)
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
    }
    const pop = () => setVariant(readVariant())
    window.addEventListener('keydown', handler); window.addEventListener('popstate', pop)
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('popstate', pop) }
  }, [variant])
  return { variant, cycle }
}

function PrototypeSidebar() {
  return <aside className="mc-sidebar"><strong className="mc-brand">Gappd</strong><nav aria-label="App sections"><button disabled><Sun size={18} />Today</button><button aria-current="page"><List size={18} />Meetings</button><button disabled><Users size={18} />People</button></nav><button disabled className="mc-settings"><Settings size={18} />Settings</button></aside>
}

export function MeetingsCalendarPrototype() {
  const { variant, cycle } = useVariant()
  const model = useDemoModel()
  const [query, setQuery] = useState('')
  const visible = model.entries.filter(e => (model.scenario !== 'disconnected' || e.kind !== 'planned') && `${e.title} ${e.people} ${model.notes[e.id]}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = model.entries.find(e => e.id === model.selected)
  const props = { entries: visible, selected: model.selected, open: model.setSelected, recording: model.recording, query }
  return <div className="mc-prototype"><PrototypeSidebar /><main className="mc-main">
    <div className="mc-scroll"><header className="mc-head"><h1>Meetings</h1><span className="mc-muted">{model.scenario === 'connected' ? 'Calendar connected' : 'Local Meetings'}</span></header>
      <div className="mc-controls"><label className="mc-search"><Search size={18} /><input aria-label="Search Meetings and events" placeholder="Search meetings and events" value={query} onChange={e => setQuery(e.target.value)} /></label>{query && <button onClick={() => setQuery('')}>Clear</button>}</div>
      <div className={`mc-workspace ${selected ? 'mc-has-detail' : ''}`}><div className="mc-results">{visible.length ? variant === 'A' ? <NextHistory {...props} /> : variant === 'B' ? <UpcomingPast key={model.scenario} {...props} /> : <OneList {...props} /> : <div className="mc-empty"><h2>{model.scenario === 'empty' ? 'Your Meetings will live here' : 'No matching items'}</h2><p>{model.scenario === 'empty' ? 'Recording works without Calendar. Choose another demo scenario below to explore.' : 'Try another search. Recorded Meetings stay available without Calendar.'}</p></div>}
      </div>{selected && <EntryDetails entry={selected} note={model.notes[selected.id]} updateNote={value => model.setNotes(n => ({ ...n, [selected.id]: value }))} recording={model.recording} record={model.record} close={() => model.setSelected(null)} />}</div>
      <details className="mc-state"><summary>Demo controls & state · nothing is saved</summary><label>Scenario<select aria-label="Demo scenario" value={model.scenario} onChange={e => model.changeScenario(e.target.value)}><option value="connected">Calendar connected</option><option value="disconnected">No Calendar connection</option><option value="empty">First use</option></select></label><pre>{JSON.stringify({ variant, query, scenario: model.scenario, selected: model.selected, recording: model.recording, entries: model.entries, notes: model.notes }, null, 2)}</pre></details>
    </div></main><nav className="mc-switcher" aria-label="Prototype variants"><button aria-label="Previous variant" onClick={() => cycle(-1)}>←</button><span aria-live="polite"><small>Demo · round 2</small>{variant} / {variantNames[variant]}</span><button aria-label="Next variant" onClick={() => cycle(1)}>→</button></nav></div>
}

function useDemoModel() {
  const [entries, setEntries] = useState(demoEntries)
  const [notes, setNotes] = useState(Object.fromEntries(demoEntries.map(e => [e.id, e.note])))
  const [selected, setSelected] = useState<string | null>(null)
  const [recording, setRecording] = useState<string | null>(null)
  const [scenario, setScenario] = useState('connected')
  const changeScenario = (next: string) => {
    setScenario(next); setSelected(null); setRecording(null)
    setEntries(next === 'empty' ? [] : demoEntries)
    setNotes(Object.fromEntries(demoEntries.map(e => [e.id, e.note])))
  }
  const record = () => {
    if (!selected) return
    if (!recording) return setRecording(selected)
    setEntries(current => current.map(e => e.id === selected ? { ...e, kind: 'recorded', linked: true } : e))
    setRecording(null)
  }
  return { entries, notes, setNotes, selected, setSelected, recording, scenario, changeScenario, record }
}
