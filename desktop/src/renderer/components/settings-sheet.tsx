import { type ReactNode, useEffect, useRef } from 'react'

const KEYDOWN_EVENT = 'keydown'
const ESCAPE_KEY = 'Escape'

type SettingsSheetProps = {
  children: ReactNode
  onClose: () => void
}

export function SettingsSheet({ children, onClose }: SettingsSheetProps) {
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
      <aside className="settings-sheet" role="dialog" aria-label="Developer Debug" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} className="settings-sheet-close" onClick={onClose} aria-label="Close developer debug">Close</button>
        {children}
      </aside>
    </div>
  )
}

function restoreFocus(element: Element | null) {
  if (element instanceof HTMLElement && document.contains(element)) element.focus()
}
