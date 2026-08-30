import { useState } from 'react'
import { AgendaVariant } from './variant-agenda'
import { FocusVariant } from './variant-focus'
import { SidebarVariant } from './variant-sidebar'
import { PrototypeSwitcher } from './prototype-switcher'
import { type CalendarKey, type ConnectionStep, type PrototypeVariant, PROTOTYPE_VARIANTS } from './model'
import './google-calendar-prototype.css'

const VARIANT_NAMES: Record<PrototypeVariant, string> = {
  A: 'Agenda first',
  B: 'Settings led',
  C: 'Time rail',
}

export function GoogleCalendarPrototype() {
  const [variant, setVariant] = useState(readVariant)
  const [step, setStep] = useState<ConnectionStep>('disconnected')
  const [selected, setSelected] = useState<CalendarKey[]>(['work', 'personal'])
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const shared = prototypeProps(step, selected, recordingId, setStep, setSelected, setRecordingId)
  return <div className="calendar-prototype"><VariantView variant={variant} props={shared} /><PrototypeState step={step} selected={selected} recordingId={recordingId} /><PrototypeSwitcher current={variant} names={VARIANT_NAMES} onChange={(next) => changeVariant(next, setVariant)} /></div>
}

function VariantView({ variant, props }: { variant: PrototypeVariant; props: ReturnType<typeof prototypeProps> }) {
  if (variant === 'B') return <SidebarVariant {...props} />
  if (variant === 'C') return <FocusVariant {...props} />
  return <AgendaVariant {...props} />
}

function prototypeProps(step: ConnectionStep, selected: CalendarKey[], recordingId: string | null, setStep: (step: ConnectionStep) => void, setSelected: (ids: CalendarKey[]) => void, setRecordingId: (id: string | null) => void) {
  return {
    step, selected, recordingId,
    onConnect: () => setStep('selecting' as const),
    onToggleCalendar: (id: CalendarKey) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]),
    onFinishSelection: () => { if (selected.length) setStep('connected') },
    onDisconnect: () => { setStep('disconnected'); setRecordingId(null) },
    onRecord: (id: string) => setRecordingId(recordingId === id ? null : id),
  }
}

function PrototypeState({ step, selected, recordingId }: { step: ConnectionStep; selected: CalendarKey[]; recordingId: string | null }) {
  return <aside className="prototype-state" aria-label="Prototype state"><strong>Prototype state</strong><span>connection: {step}</span><span>calendars: {selected.join(', ') || 'none'}</span><span>recording: {recordingId ?? 'idle'}</span></aside>
}

function readVariant(): PrototypeVariant {
  const value = new URLSearchParams(window.location.search).get('variant')
  return PROTOTYPE_VARIANTS.includes(value as PrototypeVariant) ? value as PrototypeVariant : 'A'
}

function changeVariant(next: PrototypeVariant, setVariant: (variant: PrototypeVariant) => void) {
  const url = new URL(window.location.href)
  url.searchParams.set('variant', next)
  window.history.replaceState({}, '', url)
  setVariant(next)
}
