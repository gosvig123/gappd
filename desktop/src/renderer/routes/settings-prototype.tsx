// Throwaway: three settings layouts on the existing entry URL, gated by ?variant=A|B|C.
import { useEffect, useRef, useState } from 'react'
import { categories, CategoryFields, initialSettings, type Category, type FieldsProps, type PrototypeState } from './settings-prototype-fields'
import './settings-prototype.css'

const variants = ['A', 'B', 'C'] as const
type Variant = typeof variants[number]
const names = { A: 'Category sidebar', B: 'Overview', C: 'Expandable sections' }
const descriptions = { A: 'One category at a time. Less scrolling.', B: 'Everything in view. Columns adapt to available space.', C: 'Start compact. Open only what you need.' }

function readVariant(): Variant {
  const value = new URLSearchParams(location.search).get('variant')
  return variants.includes(value as Variant) ? value as Variant : 'A'
}

function useVariant() {
  const [variant, setVariant] = useState(readVariant)
  const choose = (next: Variant) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', next)
    history.replaceState(null, '', url)
    setVariant(next)
  }
  useEffect(() => {
    const pop = () => setVariant(readVariant())
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  return { variant, choose }
}

function VariantA(props: FieldsProps) {
  const [category, setCategory] = useState<Category>('General')
  return <div className="sp-sidebar-layout"><nav aria-label="Settings categories">{categories.map(c => <button key={c} aria-current={c === category ? 'page' : undefined} onClick={() => setCategory(c)}>{c}</button>)}</nav><section><h2>{category}</h2><CategoryFields category={category} {...props} /></section></div>
}

function VariantB(props: FieldsProps) {
  return <div className="sp-overview">{categories.map(c => <section key={c}><h2>{c}</h2><CategoryFields category={c} {...props} /></section>)}</div>
}

function VariantC(props: FieldsProps) {
  return <div className="sp-disclosures">{categories.map((c, i) => <details key={c} open={i === 0}><summary><span>{c}</span><small>{i === 0 ? props.state.theme : i === 1 ? props.state.provider : `${Number(props.state.calendar) + Number(props.state.slack)} connected`}</small></summary><CategoryFields category={c} {...props} /></details>)}</div>
}

function Switcher({ variant, choose }: { variant: Variant; choose: (value: Variant) => void }) {
  const cycle = (delta: number) => choose(variants[(variants.indexOf(variant) + delta + variants.length) % variants.length])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="slider"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [variant])
  return <nav className="sp-switcher" aria-label="Prototype variants"><button aria-label="Previous variant" onClick={() => cycle(-1)}>←</button><span aria-live="polite">{variant} / {names[variant]}</span><button aria-label="Next variant" onClick={() => cycle(1)}>→</button></nav>
}

function useDimensions() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState('')
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize(`${Math.round(entry.contentRect.width)} × ${Math.round(entry.contentRect.height)}`))
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, size }
}

export function SettingsPrototype() {
  const { variant, choose } = useVariant()
  const [state, setState] = useState(initialSettings)
  const [width, setWidth] = useState(1120)
  const { ref, size } = useDimensions()
  const change: FieldsProps['change'] = (key, value) => setState(s => ({ ...s, [key]: value }))
  const props = { state, change }
  return <div className="sp-workbench" data-preview-theme={state.theme.toLowerCase()}>
    <header className="sp-app-head"><strong>Gappd</strong><span>Settings design preview</span><span className="sp-demo">Demo data only</span></header>
    <div className="sp-tools"><label>Preview width <input aria-label="Preview width" type="range" min="320" max="1440" step="20" value={width} onChange={e => setWidth(Number(e.target.value))} /></label><output>{size} px</output><button onClick={() => setState(initialSettings)}>Reset demo</button></div>
    <main ref={ref} className="sp-window" style={{ maxWidth: width }}>
      <header className="sp-heading"><div><h1>Settings</h1><p>{descriptions[variant]}</p></div><span>On this Mac</span></header>
      <div className="sp-content">{variant === 'A' ? <VariantA {...props} /> : variant === 'B' ? <VariantB {...props} /> : <VariantC {...props} />}</div>
      <StateReadout state={state} />
    </main>
    <Switcher variant={variant} choose={choose} />
  </div>
}

function StateReadout({ state }: { state: PrototypeState }) {
  return <details className="sp-state"><summary>Prototype state · changes are not saved</summary><pre>{JSON.stringify(state, null, 2)}</pre></details>
}
