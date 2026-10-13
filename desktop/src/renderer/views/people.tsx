import { type FormEvent, useState } from 'react'
import type { SavedPerson } from '../../shared/participant-contract'
import { Button, EmptyState } from '../components/ui'
import type { AppView } from '../lib/app-view'
import { isEmailName, likelyDuplicates, mergeDefaults, readableName, type DuplicatePair } from '../lib/person-identity'

type PersonRow = { person: SavedPerson; meetings: number; lastSeen?: string }
type Change = { mode: 'edit'; personId: string } | { mode: 'merge'; personId: string; otherId?: string }
const DISMISSED_DUPLICATES_KEY = 'gappd.people.notDuplicates'

export function PeopleView({ view }: { view: AppView }) {
  const rows = view.people.map((person) => personRow(person, view)).sort((left, right) => right.meetings - left.meetings)
  const [change, setChange] = useState<Change | null>(null)
  const [dismissed, dismiss] = useDismissedDuplicates()
  const duplicates = likelyDuplicates(view.people).filter((pair) => !dismissed.has(pair.id))
  const done = (people: SavedPerson[]) => { view.actions.peopleChanged(people); setChange(null) }
  return (
    <div className="app-stack">
      <header className="app-section-head">
        <p className="ui-eyebrow">Saved identities</p>
        <h1 className="ui-title">People</h1>
        <p className="app-section-sub">{rows.length} saved {rows.length === 1 ? 'person' : 'people'} · assigning a Person to a Meeting speaker names their turns and refreshes the summary</p>
      </header>
      {duplicates.length ? (
        <section className="app-people-duplicates" aria-label="Possible duplicates">
          {duplicates.map((pair) => (
            <div key={pair.id} className="app-person-duplicate">
              <span><strong>{pair.first.name}</strong> and <strong>{pair.second.name}</strong> may be the same person.</span>
              <Button className="compact-action" onClick={() => setChange(duplicateMerge(pair))}>Review merge</Button>
              <Button className="compact-action" onClick={() => dismiss(pair.id)}>Not the same</Button>
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
                <strong>{row.person.name}</strong>
                <span>{personDetail(row.person)}</span>
              </div>
              <span className="app-person-count">{row.meetings} {row.meetings === 1 ? 'Meeting' : 'Meetings'}</span>
              <span className="app-person-seen">{row.lastSeen ? `Last ${row.lastSeen}` : 'Not labeled yet'}</span>
              <span className="app-person-actions">
                <Button className="compact-action" aria-label={`Edit ${row.person.name}`} onClick={() => setChange({ mode: 'edit', personId: row.person.id })}>Edit</Button>
                {view.people.length > 1 ? <Button className="compact-action" aria-label={`Merge ${row.person.name}`} onClick={() => setChange({ mode: 'merge', personId: row.person.id })}>Merge…</Button> : null}
              </span>
              {change?.personId === row.person.id && change.mode === 'edit' ? <PersonEditor person={row.person} onDone={done} onCancel={() => setChange(null)} /> : null}
              {change?.personId === row.person.id && change.mode === 'merge' ? <PersonMerge person={row.person} people={view.people} otherId={change.otherId} onDone={done} onCancel={() => setChange(null)} /> : null}
            </li>
          ))}
        </ul>
      ) : <EmptyState>No saved People yet. Label a Meeting speaker to save them here.</EmptyState>}
    </div>
  )
}

function PersonEditor(props: { person: SavedPerson; onDone: (people: SavedPerson[]) => void; onCancel: () => void }) {
  const [name, setName] = useState(readableName(props.person))
  const [email, setEmail] = useState(props.person.email ?? '')
  const { busy, error, run } = useSubmit(() => window.gappd.meetings.updatePerson({ id: props.person.id, name: name.trim(), email: email.trim() || undefined }), props.onDone)
  return (
    <form className="app-person-form" aria-label={`Edit ${props.person.name}`} onSubmit={run}>
      <label><span>Name</span><input value={name} required maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      <label><span>Email</span><input type="email" value={email} placeholder="Optional" onChange={(event) => setEmail(event.target.value)} /></label>
      <p className="app-person-form-note">A new name replaces the old one in every Meeting transcript and summary that shows it.</p>
      <FormActions busy={busy} error={error} submit="Save" disabled={!name.trim()} onCancel={props.onCancel} />
    </form>
  )
}

function PersonMerge(props: { person: SavedPerson; people: SavedPerson[]; otherId?: string; onDone: (people: SavedPerson[]) => void; onCancel: () => void }) {
  const others = props.people.filter((person) => person.id !== props.person.id)
  const [otherId, setOtherId] = useState(props.otherId ?? '')
  const other = others.find((person) => person.id === otherId)
  const [values, setValues] = useState(() => other ? mergeDefaults(props.person, other) : { name: readableName(props.person), email: props.person.email ?? '' })
  const choose = (id: string) => {
    setOtherId(id)
    const next = others.find((person) => person.id === id)
    if (next) setValues(mergeDefaults(props.person, next))
  }
  const emails = [...new Set([props.person.email, other?.email].filter((email): email is string => Boolean(email)))]
  const { busy, error, run } = useSubmit(() => window.gappd.meetings.mergePeople({ keepId: props.person.id, mergeId: otherId, name: values.name.trim(), email: values.email || undefined }), props.onDone)
  return (
    <form className="app-person-form" aria-label={`Merge ${props.person.name}`} onSubmit={run}>
      <label><span>Same person as</span>
        <select value={otherId} required onChange={(event) => choose(event.target.value)}>
          <option value="">Choose a person…</option>
          {others.map((person) => <option key={person.id} value={person.id}>{person.name}{person.email && person.email !== person.name ? ` · ${person.email}` : ''}</option>)}
        </select>
      </label>
      {other ? <>
        <label><span>Name to keep</span><input value={values.name} required maxLength={200} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label>
        <label><span>Email to keep</span>
          <select value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })}>
            {emails.map((email) => <option key={email} value={email}>{email}</option>)}
            <option value="">No email</option>
          </select>
        </label>
        <p className="app-person-form-note">{props.person.name} and {other.name} become one Person. Their speaker labels and voice samples move to it. Meetings that show a changed name get an updated transcript and summary.</p>
      </> : null}
      <FormActions busy={busy} error={error} submit="Merge People" disabled={!other || !values.name.trim()} onCancel={props.onCancel} />
    </form>
  )
}

function FormActions(props: { busy: boolean; error: string | null; submit: string; disabled: boolean; onCancel: () => void }) {
  return <>
    <div className="actions-row">
      <Button type="submit" variant="primary" disabled={props.busy || props.disabled}>{props.busy ? 'Saving…' : props.submit}</Button>
      <Button type="button" onClick={props.onCancel} disabled={props.busy}>Cancel</Button>
    </div>
    {props.error ? <p role="alert" className="app-error app-person-form-error">{props.error}</p> : null}
  </>
}

function useSubmit(request: () => Promise<SavedPerson[]>, onDone: (people: SavedPerson[]) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(null)
    try { onDone(await request()) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }
  return { busy, error, run: (event: FormEvent) => void run(event) }
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

// Keep the Person with a real name, so the merge form starts on the record the user recognizes.
function duplicateMerge(pair: DuplicatePair): Change {
  const [kept, merged] = isEmailName(pair.first.name) && !isEmailName(pair.second.name) ? [pair.second, pair.first] : [pair.first, pair.second]
  return { mode: 'merge', personId: kept.id, otherId: merged.id }
}

function personDetail(person: SavedPerson): string {
  if (isEmailName(person.name)) return 'Name not set · Edit to add one'
  return person.email ?? 'No email saved'
}

function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
}

function personRow(person: SavedPerson, view: AppView): PersonRow {
  const matches = [...view.meetingDetails.values()].filter((detail) => detail.speakers.some((speaker) => speaker.personId === person.id || speaker.name === person.name))
  const latest = view.meetings.find((meeting) => matches.some((detail) => detail.id === meeting.id))
  return { person, meetings: matches.length, lastSeen: latest ? shortDate(latest.startedAt) : undefined }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?'
}

function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
