import { useEffect } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { type PrototypeVariant, PROTOTYPE_VARIANTS } from './model'

type PrototypeSwitcherProps = {
  current: PrototypeVariant
  names: Record<PrototypeVariant, string>
  onChange: (variant: PrototypeVariant) => void
}

export function PrototypeSwitcher({ current, names, onChange }: PrototypeSwitcherProps) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleArrowKey(event, current, onChange)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [current, onChange])
  return <nav className="prototype-switcher" aria-label="Calendar prototype variants"><button onClick={() => onChange(cycle(current, -1))} aria-label="Previous variant"><ArrowLeft /></button><span><b>{current}</b> · {names[current]}</span><button onClick={() => onChange(cycle(current, 1))} aria-label="Next variant"><ArrowRight /></button></nav>
}

function handleArrowKey(event: KeyboardEvent, current: PrototypeVariant, onChange: (variant: PrototypeVariant) => void) {
  if (isEditing(event.target) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  onChange(cycle(current, event.key === 'ArrowLeft' ? -1 : 1))
}

function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
}

function cycle(current: PrototypeVariant, delta: number): PrototypeVariant {
  const index = PROTOTYPE_VARIANTS.indexOf(current)
  return PROTOTYPE_VARIANTS[(index + delta + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length]
}
