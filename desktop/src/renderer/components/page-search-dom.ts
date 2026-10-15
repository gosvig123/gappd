export type PageSearchResult = { activeMatchOrdinal: number; matches: number }

const MARK_CLASS = 'page-search-match'
const ACTIVE_CLASS = 'page-search-active'
const SKIP_SELECTOR = '.page-search, script, style, noscript, textarea, input, select, option, [contenteditable="true"], [data-page-search-ignore]'

type TextMatch = { node: Text; start: number; end: number }

export function findPageText(query: string, activeIndex: number): PageSearchResult {
  clearPageSearch()
  const text = query.trim().toLowerCase()
  if (!text) return { activeMatchOrdinal: 0, matches: 0 }
  const matches = collectMatches(document.body, text)
  highlightMatches(matches, activeIndex)
  return { activeMatchOrdinal: matches.length ? activeIndex + 1 : 0, matches: matches.length }
}

export function clearPageSearch(): void {
  CSS.highlights.delete(MARK_CLASS)
  CSS.highlights.delete(ACTIVE_CLASS)
}

export function nextIndex(current: number, total: number, forward: boolean): number {
  if (total === 0) return 0
  return (current + (forward ? 1 : -1) + total) % total
}

function collectMatches(root: Node, query: string): TextMatch[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode })
  const matches: TextMatch[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) collectNodeMatches(node, query, matches)
  return matches
}

function acceptNode(node: Node): number {
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP_SELECTOR) || !isVisible(parent)) return NodeFilter.FILTER_REJECT
  return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0
}

function collectNodeMatches(node: Text, query: string, matches: TextMatch[]): void {
  const haystack = node.data.toLowerCase()
  for (let start = haystack.indexOf(query); start >= 0; start = haystack.indexOf(query, start + query.length)) matches.push({ node, start, end: start + query.length })
}

function highlightMatches(matches: TextMatch[], activeIndex: number): void {
  // Native highlights leave React's text nodes intact, including live playback times.
  const ranges = matches.map(({ node, start, end }) => {
    const range = new Range()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
  })
  CSS.highlights.set(MARK_CLASS, new Highlight(...ranges))
  if (ranges[activeIndex]) {
    const active = new Highlight(ranges[activeIndex])
    active.priority = 1
    CSS.highlights.set(ACTIVE_CLASS, active)
    matches[activeIndex].node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }
}
