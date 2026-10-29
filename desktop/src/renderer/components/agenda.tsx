import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { calendarEventKey, type CalendarEventSummary } from '../../shared/calendar-contract'
import { MAX_AGENDA_ITEM_LENGTH, MAX_AGENDA_ITEMS, type Agenda, type AgendaItem, type AgendaSource } from '../../shared/agenda'
import type { AppView } from '../lib/app-view'
import { shortDate } from '../lib/person-activity'
import { useConfirm } from './confirm'
import { errorText } from './person-forms'
import { Button } from './ui'
import './agenda.css'

/** The Agenda button of one Calendar event; it shows the item count once an Agenda exists. */
export function AgendaButton({ event, view, open, onToggle }: { event: CalendarEventSummary; view: AppView; open: boolean; onToggle: () => void }) {
  const count = view.agendas?.[calendarEventKey(event)]?.items.length
  return <Button className="compact-action" aria-expanded={open} onClick={onToggle}>{count ? `Agenda · ${count}` : 'Agenda'}</Button>
}

/** The editable Agenda of one Calendar event, drafted from notes of earlier Meetings with the same people. */
export function AgendaPanel({ event, view }: { event: CalendarEventSummary; view: AppView }) {
  const eventKey = calendarEventKey(event)
  const agenda = view.agendas?.[eventKey]
  const [drafting, setDrafting] = useState(false)
  const [localItemCount, setLocalItemCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  const draft = async () => {
    setDrafting(true); setError(null)
    try { await window.gappd.agenda.draft(eventKey) }
    catch (cause) { setError(errorText(cause)) }
    finally { setDrafting(false) }
  }
  const requestDraft = () => {
    if (!agenda?.items.length && !localItemCount) return void draft()
    confirm.request({ title: 'Draft the agenda again?', body: 'A new draft replaces every item, including your changes.', confirmLabel: 'Draft again', onConfirm: draft })
  }
  return (
    <section className="app-agenda" aria-label={`Agenda for ${event.title || 'event'}`}>
      <div className="app-agenda-head">
        <span className="app-agenda-note">{!view.agendas ? 'Loading agenda…' : drafting ? 'Drafting from notes of earlier Meetings with these people…' : agendaNote(agenda)}</span>
        <span className="app-agenda-actions">
          <Button className="compact-action" variant={agenda?.draftedAt ? 'secondary' : 'primary'} disabled={drafting || !view.agendas} onClick={requestDraft}>{drafting ? 'Drafting…' : agenda?.draftedAt ? 'Draft again' : 'Prepare agenda'}</Button>
        </span>
      </div>
      {error ? <p role="alert" className="app-error">{error}</p> : null}
      {view.agendas ? <AgendaEditor key={agenda?.draftedAt || 'none'} eventKey={eventKey} agenda={agenda} disabled={drafting} view={view} onItemsChange={setLocalItemCount} /> : null}
      {confirm.dialog}
    </section>
  )
}

/** Each change is saved when it is made; a new draft starts the editor again. */
function AgendaEditor({ eventKey, agenda, disabled, view, onItemsChange }: { eventKey: string; agenda?: Agenda; disabled: boolean; view: AppView; onItemsChange: (count: number) => void }) {
  const [items, setItems] = useState<AgendaItem[]>(() => agenda?.items ?? [])
  useEffect(() => onItemsChange(items.filter((item) => item.text.trim()).length), [items, onItemsChange])
  const [error, setError] = useState<string | null>(null)
  const save = async (next: AgendaItem[]) => {
    setItems(next); setError(null)
    try { await window.gappd.agenda.save(eventKey, next.filter((item) => item.text.trim())) }
    catch (cause) { setError(errorText(cause)) }
  }
  const copy = async () => {
    setError(null)
    try { await navigator.clipboard.writeText(items.map((item) => `- ${item.text}`).join('\n')) }
    catch (cause) { setError(errorText(cause)) }
  }
  const sources = new Map((agenda?.sources ?? []).map((source) => [source.ref, source]))
  const edit = (id: string, text: string) => setItems(items.map((item) => item.id === id ? { ...item, text } : item))
  const saved = (id: string) => {
    const before = agenda?.items.find((item) => item.id === id)?.text ?? ''
    const after = items.find((item) => item.id === id)?.text ?? ''
    if (before.trim() !== after.trim()) void save(items)
  }
  return (
    <>
      {items.length ? (
        <ul className="app-agenda-items">
          {items.map((item, index) => (
            <li key={item.id} className="app-agenda-item">
              <textarea rows={1} value={item.text} maxLength={MAX_AGENDA_ITEM_LENGTH} disabled={disabled} aria-label={`Agenda item ${index + 1}`}
                placeholder="New agenda item" autoFocus={!item.text && !item.sources.length}
                onChange={(event) => edit(item.id, event.target.value)} onBlur={() => saved(item.id)} />
              <button type="button" className="app-icon-action" aria-label={`Remove agenda item ${index + 1}`} disabled={disabled}
                onClick={() => void save(items.filter((other) => other.id !== item.id))}><X aria-hidden="true" /></button>
              {item.sources.length ? <SourceLinks refs={item.sources} sources={sources} view={view} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="app-error">{error}</p> : null}
      <div className="app-agenda-foot">
        <button type="button" className="app-link" disabled={disabled || items.length >= MAX_AGENDA_ITEMS}
          onClick={() => setItems([...items, { id: `u${Date.now()}`, text: '', sources: [] }])}>Add item</button>
        {items.length ? <Button className="compact-action" disabled={disabled} onClick={() => void copy()}>Copy</Button> : null}
      </div>
    </>
  )
}

function SourceLinks({ refs, sources, view }: { refs: string[]; sources: Map<string, AgendaSource>; view: AppView }) {
  return (
    <span className="app-agenda-sources">
      From {refs.flatMap((ref, index) => {
        const source = sources.get(ref)
        if (!source) return []
        const label = `${source.title || 'Untitled meeting'} · ${shortDate(source.date)}`
        return [
          index ? <span key={`${ref}-sep`}>, </span> : null,
          <button key={ref} type="button" className="app-link" onClick={() => view.actions.openMeeting(source.id)}>{label}</button>,
        ]
      })}
    </span>
  )
}

function agendaNote(agenda?: Agenda): string {
  if (!agenda) return 'Draft an agenda from notes of earlier Meetings with these people, or add your own items.'
  if (agenda.draftedAt && !agenda.sources.length) return 'No earlier Meeting with these people has notes yet. Add your own items.'
  const meetings = agenda.sources.length
  const from = meetings ? `From notes of ${meetings} earlier ${meetings === 1 ? 'Meeting' : 'Meetings'}` : 'Your items'
  return agenda.edited && meetings ? `${from} · edited` : from
}

