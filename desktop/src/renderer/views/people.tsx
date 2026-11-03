import { useState } from 'react'
import { Search, X } from 'lucide-react'
import type { GoogleAccess } from '../../shared/calendar-contract'
import type { SavedPerson } from '../../shared/participant-contract'
import { errorText, PersonMerge } from '../components/person-forms'
import { Button, EmptyState, cx } from '../components/ui'
import type { AppView } from '../lib/app-view'
import { initialsOf, personMeetings, shortDate } from '../lib/person-activity'
import { likelyDuplicates, mergeOrder, readableName, type DuplicatePair } from '../lib/person-identity'
import { PersonPage } from './person-page'
import { SpeakerQueue } from './speaker-queue'
import './people.css'

type PersonRow = { person: SavedPerson; meetings: number; lastStartedAt?: string }
type PairMerge = { pairId: string; personId: string; otherId: string }
type ContactsImportState = ReturnType<typeof useContactsImport>
const DISMISSED_DUPLICATES_KEY = 'gappd.people.notDuplicates'
// Set on this machine after the first import or "Not now"; the prompt then shrinks to a link in the header.
const CONTACTS_IMPORT_ANSWERED_KEY = 'gappd.people.contactsImportAnswered'
const SEARCH_LABEL = 'Search People by name or email'

/** The People list on the left; the chosen Person opens beside it, so the list keeps its place. */
export function PeopleView({ view }: { view: AppView }) {
  const rows = view.people.map((person) => personRow(person, view)).sort(byLastMeeting)
  const [query, setQuery] = useState('')
  const [pairMerge, setPairMerge] = useState<PairMerge | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dismissed, dismiss] = useDismissedDuplicates()
  const contactsImport = useContactsImport(view.actions.peopleChanged)
  const duplicates = likelyDuplicates(view.people).filter((pair) => !dismissed.has(pair.id))
  const hasAccess = (access: GoogleAccess) => Boolean(view.calendar?.connections.some((connection) => connection.access?.includes(access)))
  const canImport = hasAccess('contacts')
  const shown = rows.filter((row) => matchesQuery(row.person, query))
  // A merge can remove the open Person; the list then shows alone again.
  const open = view.people.find((person) => person.id === openId)
  const done = (people: SavedPerson[]) => { view.actions.peopleChanged(people); setPairMerge(null) }
  return (
    <div className={cx('people-workspace', open && 'has-selection')}>
      <header className="people-head">
        <div className="app-section-head">
          <h1 className="ui-title">People</h1>
          <p className="app-section-sub">Assigning a Person to a Meeting speaker names their turns and refreshes the summary</p>
          {canImport && contactsImport.answered ? <ContactsImportLink state={contactsImport} /> : null}
        </div>
        {rows.length ? (
          <div className="people-toolbar">
            <label className="app-search people-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={SEARCH_LABEL} aria-label={SEARCH_LABEL} />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X aria-hidden="true" /></button> : null}</label>
            <span className="people-count" role="status">{query.trim() ? `${shown.length} of ${rows.length}` : peopleCount(rows.length)}</span>
          </div>
        ) : null}
      </header>
      <div className="people-columns">
        <div className="people-list ui-scroll">
          {/* Work on the whole list waits while one Person is open. */}
          {open ? null : <SpeakerQueue view={view} />}
          {!open && canImport && !contactsImport.answered ? <ContactsImportPrompt state={contactsImport} /> : null}
          {!open && duplicates.length ? (
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
          ) : null}
          {shown.length ? (
            <ul className="people-rows" aria-label="People">
              {shown.map((row) => (
                <li key={row.person.id}>
                  <button type="button" className="people-row" aria-current={row.person.id === open?.id ? 'true' : undefined} onClick={() => setOpenId(row.person.id)}>
                    <span className="app-avatar" aria-hidden="true">{initialsOf(readableName(row.person))}</span>
                    <span className="people-row-name">{readableName(row.person)}</span>
                    <span className="people-row-detail">{row.person.email ?? 'No email saved'}</span>
                    <span className="people-row-meta">{row.lastStartedAt ? `Last ${shortDate(row.lastStartedAt)} · ${meetingCount(row.meetings)}` : 'No Meetings yet'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : rows.length ? (
            <EmptyState>No People match "{query.trim()}". <button type="button" className="app-link" onClick={() => setQuery('')}>Clear search</button></EmptyState>
          )
            : <EmptyState>No saved People yet. Label a Meeting speaker to save them here.</EmptyState>}
        </div>
        {open ? <div className="people-content ui-scroll"><PersonPage key={open.id} person={open} view={view} canEmail={hasAccess('gmail')} onBack={() => setOpenId(null)} /></div> : null}
      </div>
    </div>
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
      <span role="status">{state.error ? <span className="app-error">{state.error}</span> : 'Adds every saved Google contact with an email who is not already a Person.'}</span>
    </div>
  )
}

/** After the first import or "Not now", a later import stays one click away without a prompt. */
function ContactsImportLink({ state }: { state: ContactsImportState }) {
  return (
    <p className="app-section-sub app-people-import-link">
      <button type="button" className="app-link" disabled={state.busy} onClick={() => void state.run()}>{state.busy ? 'Importing Google contacts…' : 'Import Google contacts'}</button>
      <span role="status">{state.error ? <span className="app-error">{state.error}</span> : state.note}</span>
    </p>
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
