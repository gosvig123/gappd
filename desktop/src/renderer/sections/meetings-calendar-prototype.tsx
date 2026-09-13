// Throwaway: three merged Meetings/Calendar layouts on the renderer URL via ?variant=A|B|C.
import { useEffect, useState } from 'react'
import { List, Sun, Users, Settings, Search } from 'lucide-react'
import { demoEntries, variantNames, type Variant } from './meetings-calendar-prototype-data'
import { NextHistory } from './meetings-calendar-prototype-views'
import { MeetingContent, type ContentTab } from './meetings-calendar-prototype-content'
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
  const [tab, setTab] = useState<ContentTab>('Summary')
  const open = (id: string) => { setQuery(''); model.setSelected(id) }
  const close = () => { model.setSelected(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-entry-id="${model.selected}"]`)?.focus()) }
  const visible = model.entries.filter(e => (model.scenario !== 'disconnected' || e.kind !== 'planned') && `${e.title} ${e.people} ${e.note} ${model.notes[e.id]} ${model.topics[e.id]?.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = model.entries.find(e => e.id === model.selected)
  const props = { entries: visible, selected: model.selected, open, recording: model.recording, query }
  const content = selected && <MeetingContent entry={selected} note={model.notes[selected.id]} updateNote={value => model.setNotes(n => ({ ...n, [selected.id]: value }))} topics={model.topics[selected.id]} updateTopics={value => model.setTopics(t => ({ ...t, [selected.id]: value }))} tab={tab} setTab={setTab} recording={model.recording} record={model.record} close={close} open={open} fullPage={variant === 'B'} />
  return <div className="mc-prototype"><PrototypeSidebar /><main className="mc-main">
    <div className={`mc-scroll ${variant === 'B' && selected ? 'mc-focus-page' : ''}`}><header className="mc-head"><h1>Meetings</h1><span className="mc-muted">{model.scenario === 'connected' ? 'Calendar connected' : 'Local Meetings'}</span></header>
      <div className="mc-controls"><label className="mc-search"><Search size={18} /><input aria-label="Search Meetings and events" placeholder="Search meetings and events" value={query} onChange={e => setQuery(e.target.value)} /></label>{query && <button onClick={() => setQuery('')}>Clear</button>}</div>
      <div className={`mc-workspace mc-mode-${variant} ${selected ? 'mc-has-detail' : ''}`}>
        {!(variant === 'B' && selected) && <div className="mc-results">{visible.length ? <NextHistory {...props} inlineContent={variant === 'C' ? content : undefined} /> : <p className="mc-empty">{model.scenario === 'empty' ? 'Your Meetings will live here. Recording works without Calendar.' : 'No matching items. Try another search.'}</p>}</div>}
        {variant !== 'C' && content}
      </div>
      <details className="mc-state"><summary>Demo controls & state · nothing is saved</summary><label>Scenario<select aria-label="Demo scenario" value={model.scenario} onChange={e => model.changeScenario(e.target.value)}><option value="connected">Calendar connected</option><option value="disconnected">No Calendar connection</option><option value="empty">First use</option></select></label><pre>{JSON.stringify({ variant, tab, query, scenario: model.scenario, selected: model.selected, recording: model.recording, entries: model.entries, notes: model.notes, topics: model.topics }, null, 2)}</pre></details>
    </div></main><nav className="mc-switcher" aria-label="Prototype variants"><button aria-label="Previous variant" onClick={() => cycle(-1)}>←</button><span aria-live="polite"><small>Demo · round 3</small>{variant} / {variantNames[variant]}</span><button aria-label="Next variant" onClick={() => cycle(1)}>→</button></nav></div>
}

function useDemoModel() {
  const [entries, setEntries] = useState(demoEntries)
  const [notes, setNotes] = useState(Object.fromEntries(demoEntries.map(e => [e.id, ''])))
  const [topics, setTopics] = useState(initialTopics)
  const [selected, setSelected] = useState<string | null>('planning')
  const [recording, setRecording] = useState<string | null>(null)
  const [scenario, setScenario] = useState('connected')
  const changeScenario = (next: string) => {
    setScenario(next); setSelected(null); setRecording(null)
    setEntries(next === 'empty' ? [] : demoEntries)
    setNotes(Object.fromEntries(demoEntries.map(e => [e.id, ''])))
    setTopics(initialTopics())
  }
  const record = () => {
    if (!selected) return
    if (!recording) return setRecording(selected)
    setEntries(current => current.map(e => e.id === selected ? { ...e, kind: 'recorded', linked: true } : e))
    setRecording(null)
  }
  return { entries, notes, setNotes, topics, setTopics, selected, setSelected, recording, scenario, changeScenario, record }
}

function initialTopics(): Record<string, string[]> {
  return Object.fromEntries(demoEntries.map(entry => [entry.id, [...entry.note.split('. ').map(t => t.replace(/\.$/, '')), 'Agree on owners and next steps']]))
}
