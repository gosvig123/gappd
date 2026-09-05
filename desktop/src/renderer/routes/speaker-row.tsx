import { useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import type { SpeakerExcerpt } from '../hooks/use-speaker-audio'
import { Button } from '../components/ui'
import type { PersonOption } from './speaker-options'

export type Speaker = { key: string; name: string; personId?: string }
type Props = { excerpt?: SpeakerExcerpt | null; meetingId: string; speaker: Speaker; options: PersonOption[]; playing: boolean; play: (index: number) => void; stop: () => void; onUpdated: (meeting: MeetingDetail) => void }
const NEW_PERSON = 'new-person'

export function SpeakerRow(props: Props) {
  const { choice, name, email, busy, error, choose, save, setName, setEmail } = useSpeakerAssignment(props)
  const [clipIndex, setClipIndex] = useState(0)
  return <div className="speaker-label-row" id={`speaker-label-${encodeURIComponent(props.speaker.key)}`}><div className="speaker-label-heading"><strong>{props.speaker.name}</strong><span className="speaker-clip-actions"><Button className="compact-action" onClick={() => props.playing ? props.stop() : props.play(clipIndex)}>{props.playing ? 'Stop' : '▶ Play clip'}</Button><Button className="compact-action" onClick={() => { setClipIndex(clipIndex + 1); props.play(clipIndex + 1) }}>Another clip</Button></span></div>{props.excerpt?.text ? <blockquote className="speaker-clip-excerpt">{props.excerpt.startSec !== undefined ? <span>{clipTime(props.excerpt.startSec)} · </span> : null}{props.excerpt.text}</blockquote> : null}<select aria-label={`Assign person to ${props.speaker.name}`} value={choice} disabled={busy} onChange={event => choose(event.target.value)}><option value="">{props.speaker.personId ? 'Clear label' : 'Choose a person…'}</option>{props.options.map(person => <option key={person.value} value={person.value}>{person.name}{person.email && person.email !== person.name ? ` · ${person.email}` : ''}{person.invited ? ' · Invited' : ''}</option>)}<option value={NEW_PERSON}>Someone else…</option></select>{choice === NEW_PERSON ? <NewPersonFields name={name} email={email} busy={busy} onName={setName} onEmail={setEmail} onSave={() => void save(NEW_PERSON)} /> : null}{busy ? <span role="status">Updating name…</span> : null}{error ? <p role="alert">{error}</p> : null}</div>
}

function NewPersonFields(props: { name: string; email: string; busy: boolean; onName: (value: string) => void; onEmail: (value: string) => void; onSave: () => void }) {
  return <form className="speaker-new-person" onSubmit={event => { event.preventDefault(); props.onSave() }}><input aria-label="Person name" placeholder="Name" required value={props.name} onChange={event => props.onName(event.target.value)} /><input aria-label="Person email" type="email" placeholder="Email (optional)" value={props.email} onChange={event => props.onEmail(event.target.value)} /><Button type="submit" disabled={props.busy || !props.name.trim()}>Save person</Button></form>
}

function useSpeakerAssignment(props: Props) {
  const [choice, setChoice] = useState(props.speaker.personId ?? '')
  const [name, setName] = useState(''), [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const save = async (value: string) => {
    setError(null); setBusy(true)
    try { const person = props.options.find(option => option.value === value); props.onUpdated(await window.gappd.meetings.assignSpeaker({ id: props.meetingId, speakerKey: props.speaker.key, personId: person?.personId, name: value === NEW_PERSON ? name.trim() : person?.name, email: value === NEW_PERSON ? email.trim() || undefined : person?.email })) }
    catch (cause) { if (value !== NEW_PERSON) setChoice(props.speaker.personId ?? ''); setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const choose = (value: string) => { setChoice(value); setError(null); if (value !== NEW_PERSON) void save(value) }
  return { choice, name, email, busy, error, choose, save, setName, setEmail }
}

function clipTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
