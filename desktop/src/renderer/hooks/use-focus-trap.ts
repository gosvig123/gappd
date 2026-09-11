import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Mounted modal surfaces, oldest first. The newest one owns the Tab key. */
const owners: HTMLElement[] = []

/**
 * Keeps Tab inside one modal surface, so `aria-modal="true"` tells the truth.
 * A confirmation layered over the Meeting layover takes the keys; the layover
 * resumes when the confirmation closes.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = container.current
    if (!node) return undefined
    owners.push(node)
    const handler = (event: KeyboardEvent) => { if (event.key === 'Tab' && owners[owners.length - 1] === node) trapTab(event, node) }
    window.addEventListener('keydown', handler, { capture: true })
    return () => {
      window.removeEventListener('keydown', handler, { capture: true })
      owners.splice(owners.indexOf(node), 1)
    }
  }, [container])
}

function trapTab(event: KeyboardEvent, node: HTMLElement): void {
  const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
  event.preventDefault()
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index === -1) return items[event.shiftKey ? items.length - 1 : 0].focus()
  items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus()
}
