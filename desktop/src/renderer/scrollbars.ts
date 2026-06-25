const SCROLLBAR_ACTIVE_CLASS = 'is-scrollbar-active'
const SCROLLBAR_IDLE_DELAY_MS = 900

const scrollTimers = new WeakMap<Element, number>()

const scrollElementFor = (target: EventTarget | null): Element | null => {
  if (target instanceof Document) return document.scrollingElement
  if (target instanceof Element) return target
  return null
}

const clearScrollTimer = (element: Element): void => {
  const timer = scrollTimers.get(element)
  if (timer) window.clearTimeout(timer)
}

const hideScrollbar = (element: Element): void => {
  element.classList.remove(SCROLLBAR_ACTIVE_CLASS)
  scrollTimers.delete(element)
}

const showScrollbar = (element: Element): void => {
  clearScrollTimer(element)
  element.classList.add(SCROLLBAR_ACTIVE_CLASS)
  scrollTimers.set(element, window.setTimeout(() => hideScrollbar(element), SCROLLBAR_IDLE_DELAY_MS))
}

export const installTransientScrollbars = (): void => {
  document.addEventListener('scroll', (event) => {
    const element = scrollElementFor(event.target)
    if (!element) return
    showScrollbar(element)
  }, true)
}
