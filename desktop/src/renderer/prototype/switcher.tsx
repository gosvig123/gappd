import { useEffect } from 'react'
import type { ThemeName } from './contract'
import type { Variant } from './variants'

type SwitcherProps = {
  variants: Variant[]
  current: Variant
  theme: ThemeName
  onSelect: (key: string) => void
  onToggleTheme: () => void
}

/** Floating control that only exists in the prototype build. */
export function PrototypeSwitcher({ variants, current, theme, onSelect, onToggleTheme }: SwitcherProps) {
  const index = variants.findIndex((variant) => variant.key === current.key)
  const step = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]
    if (next) onSelect(next.key)
  }
  useArrowKeys(step)
  return (
    <div className="proto-switcher">
      <div className="proto-switcher-pill" role="group" aria-label="Prototype variant">
        <button type="button" className="proto-switcher-step" onClick={() => step(-1)} aria-label="Previous variant">←</button>
        <span className="proto-switcher-label">
          {current.key.toUpperCase()} · {current.name}
          <br />
          <span>{current.tagline}</span>
        </span>
        <button type="button" className="proto-switcher-step" onClick={() => step(1)} aria-label="Next variant">→</button>
        <span className="proto-switcher-divider" aria-hidden="true" />
        <button type="button" className="proto-switcher-theme" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </div>
  )
}

function useArrowKeys(step: (delta: number) => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      step(event.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [step])
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}
