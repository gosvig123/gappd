import { useState } from 'react'
import type { GoogleAccess } from '../../shared/calendar-contract'
import type { SavedPerson } from '../../shared/participant-contract'
import { PersonEmail } from '../components/person-email'
import { errorText, PersonEditor, PersonMerge } from '../components/person-forms'
import { Button, EmptyState } from '../components/ui'
import type { AppView } from '../lib/app-view'
import { initialsOf, personMeetings, shortDate } from '../lib/person-activity'
import { isEmailName, likelyDuplicates, mergeOrder, readableName, type DuplicatePair } from '../lib/person-identity'
import { PersonPage } from './person-page'
import { SpeakerQueue } from './speaker-queue'

type PersonRow = { person: SavedPerson; meetings: number; lastSeen?: string }
type Change = { mode: 'edit' | 'email'; personId: string } | { mode: 'merge'; personId: string; otherId?: string; pairId?: string }
const DISMISSED_DUPLICATES_KEY = 'gappd.people.notDuplicates'

export function PeopleView({ view }: { view: AppView }) {
  const rows = view.people.map((person) => personRow(person, view)).sort((left, right) => right.meetings - left.meetings)
  const [change, setChange] = useState<Change | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dismissed, dismiss] = useDismissedDuplicates()
  const duplicates = likelyDuplicates(view.people).filter((pair) => !dismissed.has(pair.id))
  const done = (people: SavedPerson[]) => { view.actions.peopleChanged(people); setChange(null) }
  const hasAccess = (access: GoogleAccess) => Boolean(view.calendar?.connections.some((connection) => connection.access?.includes(access)))
  // A merge can remove the open Person; the list shows again then.
  const open = view.people.find((person) => person.id === openId)
  if (open) return <PersonPage person={open} view={view} canEmail={hasAccess('gmail')} onBack={() => setOpenId(null)} />
  return (
    <div className="app-stack">
      <header className="app-section-head">
        <p className="ui-eyebrow">Saved identities</p>
        <h1 className="ui-title">People</h1>
        <p className="app-section-sub">{rows.length} saved {rows.length === 1 ? 'person' : 'people'} · assigning a Person to a Meeting speaker names their turns and refreshes the summary</p>
      </header>
      <SpeakerQueue view={view} />
      {hasAccess('contacts') ? <ContactsImport onDone={view.actions.peopleChanged} /> : null}
      {duplicates.length ? (
        <section className="app-people-duplicates" aria-label="Possible duplicates">
          {duplicates.map((pair) => (
            <div key={pair.id} className="app-person-duplicate">
              <span><strong>{pair.first.name}</strong> and <strong>{pair.second.name}</strong> may be the same person.</span>
              <Button className="compact-action" aria-expanded={isPairChange(change, pair)} onClick={() => setChange(isPairChange(change, pair) ? null : duplicateMerge(pair))}>Review merge</Button>
              <Button className="compact-action" onClick={() => dismiss(pair.id)}>Not the same</Button>
              {/* The review opens where it was asked for, not in a Person row further down the list. */}
              {change?.mode === 'merge' && isPairChange(change, pair) ? <PersonMerge key={pair.id} person={mergeOrder(pair)[0]} people={view.people} otherId={change.otherId} onDone={done} onCancel={() => setChange(null)} /> : null}
            </div>
          ))}
        </section>
      ) : null}
      {rows.length ? (
        <ul className="app-people">
          {rows.map((row) => (
            <li key={row.person.id} className="app-person">
              <span className="app-avatar" aria-hidden="true">{initialsOf(readableName(row.person))}</span>
              <div className="app-person-copy">
                <button type="button" className="app-person-name" onClick={() => setOpenId(row.person.id)}>{row.person.name}</button>
                <span>{personDetail(row.person)}</span>
              </div>
              <span className="app-person-count">{row.meetings} {row.meetings === 1 ? 'Meeting' : 'Meetings'}</span>
              <span className="app-person-seen">{row.lastSeen ? `Last ${row.lastSeen}` : 'Not labeled yet'}</span>
              <span className="app-person-actions">
                {hasAccess('gmail') && row.person.email ? <Button className="compact-action" aria-label={`Email with ${row.person.name}`} aria-expanded={change?.personId === row.person.id && change.mode === 'email'} onClick={() => setChange(change?.personId === row.person.id && change.mode === 'email' ? null : { mode: 'email', personId: row.person.id })}>Email</Button> : null}
                <Button className="compact-action" aria-label={`Edit ${row.person.name}`} onClick={() => setChange({ mode: 'edit', personId: row.person.id })}>Edit</Button>
                {view.people.length > 1 ? <Button className="compact-action" aria-label={`Merge ${row.person.name}`} onClick={() => setChange({ mode: 'merge', personId: row.person.id })}>Merge…</Button> : null}
              </span>
              {change?.personId === row.person.id && change.mode === 'edit' ? <PersonEditor person={row.person} onDone={done} onCancel={() => setChange(null)} /> : null}
              {change?.personId === row.person.id && change.mode === 'email' && row.person.email ? <PersonEmail name={row.person.name} email={row.person.email} /> : null}
              {change?.personId === row.person.id && change.mode === 'merge' && !change.pairId ? <PersonMerge person={row.person} people={view.people} onDone={done} onCancel={() => setChange(null)} /> : null}
            </li>
          ))}
        </ul>
      ) : <EmptyState>No saved People yet. Label a Meeting speaker to save them here.</EmptyState>}
    </div>
  )
}

function ContactsImport({ onDone }: { onDone: (people: SavedPerson[]) => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true); setError(null); setNote('')
    try {
      const result = await window.gappd.meetings.importGoogleContacts()
      onDone(result.people)
      setNote(importNote(result.added, result.updated))
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }
  return (
    <div className="app-people-import">
      <Button className="compact-action" disabled={busy} onClick={() => void run()}>{busy ? 'Importing…' : 'Import Google contacts'}</Button>
      <span role="status">{error ? <span className="app-error">{error}</span> : note || 'Adds every saved Google contact with an email who is not already a Person.'}</span>
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

function duplicateMerge(pair: DuplicatePair): Change {
  const [kept, merged] = mergeOrder(pair)
  return { mode: 'merge', personId: kept.id, otherId: merged.id, pairId: pair.id }
}

function isPairChange(change: Change | null, pair: DuplicatePair): boolean {
  return change?.mode === 'merge' && change.pairId === pair.id
}

function personDetail(person: SavedPerson): string {
  if (isEmailName(person.name)) return 'Name not set · Edit to add one'
  return person.email ?? 'No email saved'
}

function personRow(person: SavedPerson, view: AppView): PersonRow {
  const meetings = personMeetings(person, view)
  return { person, meetings: meetings.length, lastSeen: meetings[0] ? shortDate(meetings[0].startedAt) : undefined }
}
