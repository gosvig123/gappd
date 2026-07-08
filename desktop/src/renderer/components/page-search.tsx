import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon, SearchIcon } from './icons'
import { cx } from './ui'
import { clearPageSearch, findPageText, nextIndex, type PageSearchResult } from './page-search-dom'
import './page-search.css'

const SEARCH_SHORTCUT_KEY = 'f'
const EMPTY_RESULT: PageSearchResult = { activeMatchOrdinal: 0, matches: 0 }

export function PageSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [result, setResult] = useState(EMPTY_RESULT)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useCallback((index: number) => setResult(findPageText(query, index)), [query])
  useSearchShortcut(setOpen, inputRef)
  useEffect(() => () => clearPageSearch(), [])
  useEffect(() => updateSearch(open, query, setActiveIndex, setResult), [open, query])
  useEffect(() => { if (open) focusSearchInput(inputRef) }, [open])
  if (!open) return null
  return <div className="page-search" role="search"><SearchIcon className="page-search-icon" aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => handleInputKey(event, result, activeIndex, search, setActiveIndex, setOpen)} placeholder="Find on screen" aria-label="Find on screen" /><span className={cx('page-search-count', result.matches === 0 && query.trim() && 'empty')}>{searchStatus(query, result)}</span><button type="button" onClick={() => moveSearch(false, result, activeIndex, search, setActiveIndex)} disabled={!result.matches} aria-label="Previous match">↑</button><button type="button" onClick={() => moveSearch(true, result, activeIndex, search, setActiveIndex)} disabled={!result.matches} aria-label="Next match">↓</button><button type="button" onClick={() => closeSearch(setOpen)} aria-label="Close search"><CloseIcon aria-hidden="true" /></button></div>
}

function updateSearch(open: boolean, query: string, setActiveIndex: (index: number) => void, setResult: (result: PageSearchResult) => void): void {
  setActiveIndex(0)
  if (open) return setResult(findPageText(query, 0))
  clearPageSearch()
  setResult(EMPTY_RESULT)
}

function moveSearch(forward: boolean, result: PageSearchResult, activeIndex: number, search: (index: number) => void, setActiveIndex: (index: number) => void): void {
  const index = nextIndex(activeIndex, result.matches, forward)
  setActiveIndex(index)
  search(index)
}

function useSearchShortcut(setOpen: (open: boolean) => void, inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => handleShortcut(event, setOpen, inputRef)
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [inputRef, setOpen])
}

function handleShortcut(event: globalThis.KeyboardEvent, setOpen: (open: boolean) => void, inputRef: RefObject<HTMLInputElement | null>): void {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== SEARCH_SHORTCUT_KEY) return
  event.preventDefault()
  setOpen(true)
  focusSearchInput(inputRef)
}

function handleInputKey(event: ReactKeyboardEvent<HTMLInputElement>, result: PageSearchResult, activeIndex: number, search: (index: number) => void, setActiveIndex: (index: number) => void, setOpen: (open: boolean) => void): void {
  if (event.key === 'Escape') return closeSearch(setOpen)
  if (event.key !== 'Enter') return
  event.preventDefault()
  moveSearch(!event.shiftKey, result, activeIndex, search, setActiveIndex)
}

function searchStatus(query: string, result: PageSearchResult): string {
  if (!query.trim()) return 'Type to search'
  if (result.matches === 0) return 'No matches'
  return `${result.activeMatchOrdinal}/${result.matches}`
}

function focusSearchInput(ref: RefObject<HTMLInputElement | null>): void {
  requestAnimationFrame(() => {
    ref.current?.focus()
    ref.current?.select()
  })
}

function closeSearch(setOpen: (open: boolean) => void): void {
  setOpen(false)
  clearPageSearch()
}
