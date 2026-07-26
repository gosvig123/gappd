import { type ReactNode, useEffect, useRef } from 'react'
import { CloseIcon, GearIcon } from './icons'

const KEYDOWN_EVENT = 'keydown'
const ESCAPE_KEY = 'Escape'

type SettingsSheetProps = {
  children: ReactNode
  currentVersion?: string
  onClose: () => void
}

export function SettingsSheet({ children, currentVersion, onClose }: SettingsSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    closeRef.current?.focus()
    return () => restoreFocus(previousFocusRef.current)
  }, [])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === ESCAPE_KEY) onClose()
    }
    window.addEventListener(KEYDOWN_EVENT, closeOnEscape)
    return () => window.removeEventListener(KEYDOWN_EVENT, closeOnEscape)
  }, [onClose])

  return (
    <div className="settings-sheet-layer" onMouseDown={onClose}>
      <aside className="settings-sheet" role="dialog" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-sheet-head">
          <span className="settings-sheet-mark"><GearIcon /></span>
          <div className="settings-sheet-titles">
            <h1>Settings</h1>
            {currentVersion ? <p>Gappd {currentVersion}</p> : null}
            <p>Speech-to-text runs entirely on your device — no audio ever leaves your Mac.</p>
          </div>
          <button ref={closeRef} className="settings-sheet-close" onClick={onClose} aria-label="Close settings"><CloseIcon /></button>
        </header>
        <div className="settings-sheet-body">{children}</div>
      </aside>
    </div>
  )
}

function restoreFocus(element: Element | null) {
  if (element instanceof HTMLElement && document.contains(element)) element.focus()
}
