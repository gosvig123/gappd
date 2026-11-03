import { useRef, useState, type RefObject } from 'react'
import { Ellipsis, Search, X } from 'lucide-react'
import type { GoogleAccess } from '../../shared/calendar-contract'
import type { SavedPerson } from '../../shared/participant-contract'
import { errorText, PersonMerge } from '../components/person-forms'
import { Button, EmptyState, cx } from '../components/ui'
import type { AppView } from '../lib/app-view'
import { initialsOf, personMeetings, shortDate } from '../lib/person-activity'
import { likelyDuplicates, mergeOrder, readableName, type DuplicatePair } from '../lib/person-identity'
import { PersonPage } from './person-page'
import { SpeakerQueue, unnamedSpeakerCount } from './speaker-queue'
import './people.css'

type PersonRow = { person: SavedPerson; meetings: number; lastStartedAt?: string }
type PersonGroup = { label: string; rows: PersonRow[] }
type PairMerge = { pairId: string; personId: string; otherId: string }
type ContactsImportState = ReturnType<typeof useContactsImport>
const DISMISSED_DUPLICATES_KEY = 'gappd.people.notDuplicates'
// Set on this machine after the first import or "Not now"; the prompt then moves to the header menu only.
const CONTACTS_IMPORT_ANSWERED_KEY = 'gappd.people.contactsImportAnswered'
const SEARCH_LABEL = 'Search People by name or email'
const RECENT_DAYS = 30
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

/** The People list on the left; the chosen Person opens beside it, so the list keeps its place. */
export function PeopleView({ view }: { view: AppView }) {
  const rows = view.people.map((person) => personRow(person, view)).sort(byLastMeeting)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [dismissed, dismiss] = useDismissedDuplicates()
  const listRef = useRef<HTMLDivElement>(null)
  const contactsImport = useContactsImport(view.actions.peopleChanged)
  const duplicates = likelyDuplicates(view.people).filter((pair) => !dismissed.has(pair.id))
  const hasAccess = (access: GoogleAccess) => Boolean(view.calendar?.connections.some((connection) => connection.access?.includes(access)))
  const canImport = hasAccess('contacts')
  const shown = rows.filter((row) => matchesQuery(row.person, query))
  // A merge can remove the open Person; the list then shows alone again.
  const open = view.people.find((person) => person.id === openId)
  const importStatus = contactsImport.busy ? 'Importing Google contacts…' : contactsImport.error ? <span className="app-error">{contactsImport.error}</span> : contactsImport.note
  return (
    <div className={cx('people-workspace', open && 'has-selection')}>
      <header className="people-head">
        <div className="people-title">
          <h1 className="ui-title">People</h1>
          {rows.length ? <span className="people-count" role="status">{query.trim() ? `${shown.length} of ${rows.length}` : peopleCount(rows.length)}</span> : null}
          {canImport ? <PeopleMenu state={contactsImport} /> : null}
        </div>
        {importStatus ? <p className="app-section-sub" role="status">{importStatus}</p> : null}
        {rows.length ? (
          <label className="app-search people-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={SEARCH_LABEL} aria-label={SEARCH_LABEL} />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden="true" /></button> : null}</label>
        ) : null}
      </header>
      <div className={cx('people-columns', !open && shown.length > 0 && 'has-jump')}>
        <div ref={listRef} className="people-list ui-scroll">
          {/* Work on the whole list waits while one Person is open. */}
          {open ? null : <ToReview view={view} duplicates={duplicates} dismiss={dismiss} askImport={canImport && !contactsImport.answered} contactsImport={contactsImport} />}
          {shown.length ? groupByLastMeeting(shown).map((group) => (
            <section key={group.label} className="people-group" aria-label={group.label}>
              <h2>{group.label} <span>{group.rows.length}</span></h2>
              <ul className="people-rows">
                {group.rows.map((row) => (
                  <li key={row.person.id} data-letter={letterOf(row.person)}>
                    <button type="button" className="people-row" aria-current={row.person.id === open?.id ? 'true' : undefined} onClick={() => setOpenId(row.person.id)}>
                      <span className="app-avatar" aria-hidden="true">{initialsOf(readableName(row.person))}</span>
                      <span className="people-row-name">{readableName(row.person)}</span>
                      <span className="people-row-detail">{row.person.email ?? ''}</span>
                      <span className="people-row-meta">{row.lastStartedAt ? `${shortDate(row.lastStartedAt)} · ${meetingCount(row.meetings)}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )) : rows.length ? (
            <EmptyState>No People match "{query.trim()}". <button type="button" className="app-link" onClick={() => setQuery('')}>Clear search</button></EmptyState>
          )
            : <EmptyState>No saved People yet. Label a Meeting speaker to save them here.</EmptyState>}
        </div>
        {!open && shown.length ? <LetterJump rows={shown} listRef={listRef} /> : null}
        {open ? <div className="people-content ui-scroll"><PersonPage key={open.id} person={open} view={view} canEmail={hasAccess('gmail')} onBack={() => setOpenId(null)} /></div> : null}
      </div>
    </div>
  )
}

/** One line for the list's open work: speakers to name, possible duplicates, and the first contacts import. */
function ToReview({ view, duplicates, dismiss, askImport, contactsImport }: { view: AppView; duplicates: DuplicatePair[]; dismiss: (id: string) => void; askImport: boolean; contactsImport: ContactsImportState }) {
  const speakers = unnamedSpeakerCount(view)
  const parts = [
    speakers ? `${speakers} unnamed ${speakers === 1 ? 'speaker' : 'speakers'}` : '',
    duplicates.length ? `${duplicates.length} possible ${duplicates.length === 1 ? 'duplicate' : 'duplicates'}` : '',
    askImport ? 'Google contacts to import' : '',
  ].filter(Boolean)
  if (!parts.length) return null
  return (
    <details className="people-review">
      <summary>{speakers + duplicates.length + Number(askImport)} to review: {parts.join(', ')}</summary>
      <div className="people-review-body">
        <SpeakerQueue view={view} />
        {duplicates.length ? <PossibleDuplicates view={view} duplicates={duplicates} dismiss={dismiss} /> : null}
        {askImport ? <ContactsImportPrompt state={contactsImport} /> : null}
      </div>
    </details>
  )
}

function PossibleDuplicates({ view, duplicates, dismiss }: { view: AppView; duplicates: DuplicatePair[]; dismiss: (id: string) => void }) {
  const [pairMerge, setPairMerge] = useState<PairMerge | null>(null)
  const done = (people: SavedPerson[]) => { view.actions.peopleChanged(people); setPairMerge(null) }
  return (
    <section className="app-people-duplicates" aria-label="Possible duplicates">
      {duplicates.map((pair) => (
        <div key={pair.id} className="app-person-duplicate">
          <span><strong>{pair.first.name}</strong> and <strong>{pair.second.name}</strong> may be the same person.</span>
          <Button className="compact-action" aria-expanded={pairMerge?.pairId === pair.id} onClick={() => setPairMerge(pairMerge?.pairId === pair.id ? null : duplicateMerge(pair))}>Review merge</Button>
          <Button className="compact-action" onClick={() => dismiss(pair.id)}>Not the same</Button>
          {pairMerge?.pairId === pair.id ? <PersonMerge key={pair.id} person={mergeOrder(pair)[0]} people={view.people} otherId={pairMerge.otherId} onDone={done} onCancel={() => setPairMerge(null)} /> : null}
        </div>
      ))}
    </section>
  )
}

/** The header's "⋯" menu; it keeps the Google contacts import one click away after the first answer. */
function PeopleMenu({ state }: { state: ContactsImportState }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // Closing removes the focused item, so focus goes back to the button that opened the menu.
  const close = () => { setOpen(false); trigger.current?.focus() }
  return (
    <div className="people-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close() } }}>
      <button ref={trigger} type="button" className="app-icon-action" aria-label="More People actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Ellipsis aria-hidden="true" /></button>
      {open ? (
        <div className="ui-card people-menu-list" role="menu">
          <button type="button" role="menuitem" className="list-row" disabled={state.busy} onClick={() => { close(); void state.run() }}>Import Google contacts</button>
        </div>
      ) : null}
    </div>
  )
}

/** A letter scrolls the list to the first shown Person whose name starts with it. */
function LetterJump({ rows, listRef }: { rows: PersonRow[]; listRef: RefObject<HTMLDivElement | null> }) {
  const present = new Set(rows.map((row) => letterOf(row.person)))
  const jump = (letter: string) => {
    const item = listRef.current?.querySelector(`[data-letter="${letter}"]`)
    item?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    item?.querySelector('button')?.focus({ preventScroll: true })
  }
  return (
    <nav className="people-jump" aria-label="Jump to letter">
      {LETTERS.map((letter) => <button key={letter} type="button" disabled={!present.has(letter)} aria-label={letter === '#' ? 'Jump to names that do not start with a letter' : `Jump to ${letter}`} onClick={() => jump(letter)}>{letter}</button>)}
    </nav>
  )
}

function useContactsImport(onDone: (people: SavedPerson[]) => void) {
  const [answered, setAnswered] = useState(() => window.localStorage.getItem(CONTACTS_IMPORT_ANSWERED_KEY) === 'true')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const answer = () => { window.localStorage.setItem(CONTACTS_IMPORT_ANSWERED_KEY, 'true'); setAnswered(true) }
  const run = async () => {
    setBusy(true); setError(null); setNote('')
    try {
      const result = await window.gappd.meetings.importGoogleContacts()
      onDone(result.people)
      setNote(importNote(result.added, result.updated))
      answer()
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }
  return { answered, note, error, busy, run, answer }
}

function ContactsImportPrompt({ state }: { state: ContactsImportState }) {
  return (
    <div className="app-people-import">
      <Button className="compact-action" disabled={state.busy} onClick={() => void state.run()}>{state.busy ? 'Importing…' : 'Import Google contacts'}</Button>
      <Button className="compact-action" disabled={state.busy} onClick={state.answer}>Not now</Button>
      <span>Adds every saved Google contact with an email who is not already a Person.</span>
    </div>
  )
}

function importNote(added: number, updated: number): string {
  if (!added && !updated) return 'No new contacts: everyone with an email is already a Person.'
  const parts = [added ? `Added ${added} ${added === 1 ? 'Person' : 'People'}` : '', updated ? `added the email of ${updated} existing ${updated === 1 ? 'Person' : 'People'}` : ''].filter(Boolean)
  return `${parts.join(' and ')}.`.replace(/^a/, 'A')
}

function useDismissedDuplicates(): [ReadonlySet<string>, (id: string) => void] {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set(readDismissed()))
  const dismiss = (id: string) => {
    const next = new Set([...dismissed, id])
    window.localStorage.setItem(DISMISSED_DUPLICATES_KEY, JSON.stringify([...next]))
    setDismissed(next)
  }
  return [dismissed, dismiss]
}

function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(DISMISSED_DUPLICATES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function duplicateMerge(pair: DuplicatePair): PairMerge {
  const [kept, merged] = mergeOrder(pair)
  return { pairId: pair.id, personId: kept.id, otherId: merged.id }
}

/** Groups in list order: Meetings in the last 30 days, older Meetings, then People without a Meeting. */
function groupByLastMeeting(rows: PersonRow[], now = Date.now()): PersonGroup[] {
  const since = now - RECENT_DAYS * 24 * 60 * 60 * 1000
  const startedAt = (row: PersonRow) => (row.lastStartedAt ? new Date(row.lastStartedAt).getTime() : null)
  return [
    { label: `Last ${RECENT_DAYS} days`, rows: rows.filter((row) => (startedAt(row) ?? -Infinity) >= since) },
    { label: 'Earlier', rows: rows.filter((row) => { const time = startedAt(row); return time !== null && time < since }) },
    { label: 'No Meetings yet', rows: rows.filter((row) => startedAt(row) === null) },
  ].filter((group) => group.rows.length)
}

function letterOf(person: SavedPerson): string {
  const letter = readableName(person).normalize('NFD').charAt(0).toUpperCase()
  return letter >= 'A' && letter <= 'Z' ? letter : '#'
}

function matchesQuery(person: SavedPerson, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const text = `${person.name} ${person.email ?? ''}`.toLowerCase()
  return words.every((word) => text.includes(word))
}

/** Most recent Meeting first; People without a Meeting follow by name. */
function byLastMeeting(left: PersonRow, right: PersonRow): number {
  if (left.lastStartedAt !== right.lastStartedAt) return (right.lastStartedAt ?? '').localeCompare(left.lastStartedAt ?? '')
  return readableName(left.person).localeCompare(readableName(right.person))
}

function peopleCount(count: number): string {
  return `${count} ${count === 1 ? 'Person' : 'People'}`
}

function meetingCount(count: number): string {
  return `${count} ${count === 1 ? 'Meeting' : 'Meetings'}`
}

function personRow(person: SavedPerson, view: AppView): PersonRow {
  const meetings = personMeetings(person, view)
  return { person, meetings: meetings.length, lastStartedAt: meetings[0]?.startedAt }
}
