import { type FormEvent, useState } from 'react'
import type { SavedPerson } from '../../shared/participant-contract'
import { mergeDefaults, readableName } from '../lib/person-identity'
import { Button } from './ui'

export function PersonEditor(props: { person: SavedPerson; onDone: (people: SavedPerson[]) => void; onCancel: () => void }) {
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

export function PersonMerge(props: { person: SavedPerson; people: SavedPerson[]; otherId?: string; onDone: (people: SavedPerson[]) => void; onCancel: () => void }) {
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

export function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
}
