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

/**
 * Publish the width a scrollbar takes from layout as --scrollbar-gutter (0 with overlay
 * scrollbars). The scroll view keeps that gutter and gives it back from its padding, so its
 * content lines up with the record bar above it whether or not the page scrolls.
 */
const publishScrollbarGutter = (): void => {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:-999px;inline-size:100px;block-size:100px;overflow:scroll'
  document.body.append(probe)
  document.documentElement.style.setProperty('--scrollbar-gutter', `${probe.offsetWidth - probe.clientWidth}px`)
  probe.remove()
}

export const installTransientScrollbars = (): void => {
  publishScrollbarGutter()
  document.addEventListener('scroll', (event) => {
    const element = scrollElementFor(event.target)
    if (!element) return
    showScrollbar(element)
  }, true)
}
