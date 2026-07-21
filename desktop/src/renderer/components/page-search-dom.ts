export type PageSearchResult = { activeMatchOrdinal: number; matches: number }

const MARK_CLASS = 'page-search-match'
const ACTIVE_CLASS = 'active'
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
  for (const mark of document.querySelectorAll(`.${MARK_CLASS}`)) unwrapMark(mark)
  document.body.normalize()
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
  for (const [node, nodeMatches] of groupByNode(matches)) highlightNode(node, nodeMatches, matches.indexOf(nodeMatches[0]), activeIndex)
  document.querySelectorAll(`.${MARK_CLASS}`)[activeIndex]?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

function groupByNode(matches: TextMatch[]): Array<[Text, TextMatch[]]> {
  const groups = new Map<Text, TextMatch[]>()
  for (const match of matches) groups.set(match.node, [...groups.get(match.node) ?? [], match])
  return [...groups]
}

function highlightNode(node: Text, matches: TextMatch[], offset: number, activeIndex: number): void {
  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const [index, match] of matches.entries()) {
    appendText(fragment, node.data.slice(cursor, match.start))
    fragment.append(markText(node.data.slice(match.start, match.end), offset + index === activeIndex))
    cursor = match.end
  }
  appendText(fragment, node.data.slice(cursor))
  node.replaceWith(fragment)
}

function markText(text: string, active: boolean): HTMLElement {
  const mark = document.createElement('mark')
  mark.className = active ? `${MARK_CLASS} ${ACTIVE_CLASS}` : MARK_CLASS
  mark.textContent = text
  return mark
}

function appendText(fragment: DocumentFragment, text: string): void {
  if (text) fragment.append(document.createTextNode(text))
}

function unwrapMark(mark: Element): void {
  mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
}
