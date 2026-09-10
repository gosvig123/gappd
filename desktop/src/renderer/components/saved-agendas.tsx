import { useCallback, useEffect, useState } from 'react'
import type { SavedAgendaDraft } from '../../shared/agenda-draft'
import { agendaDraftCanGenerate, agendaDraftEvent, savedAgendaDraftsOutsideUpcoming } from '../../shared/agenda-draft'
import type { CalendarSnapshot } from '../../shared/calendar-contract'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'
import { MeetingAgendaDraftPanel } from './meeting-agenda-draft'
import { Button, EmptyState } from './ui'

type Props = {
  calendar: GoogleCalendarController
  knownMeetingIds?: ReadonlySet<string>
  onOpenMeeting: (id: string) => void
  onOpenSettings: () => void
}

/**
 * Saved agendas stay reachable after an event leaves Upcoming, including when no
 * Calendar account is connected. Upcoming events keep their single editor, so
 * this list excludes them to avoid duplicate editors for the same event.
 */
export function SavedAgendas({ calendar, knownMeetingIds, onOpenMeeting, onOpenSettings }: Props) {
  const [records, setRecords] = useState<SavedAgendaDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const reload = useCallback(() => loadRecords(setRecords, setError, setLoading), [])
  useEffect(() => { reload() }, [reload])
  const events = calendar.snapshot?.events ?? []
  const listed = savedAgendaDraftsOutsideUpcoming(records, events)
  const open = listed.find((record) => record.draftKey === openKey) ?? null
  return (
    <section className="calendar-agenda" aria-label="Saved agendas">
      <div className="calendar-agenda-head"><div><strong>Saved agendas</strong><span>{summaryLabel(listed.length)}</span></div><Button className="compact-action" onClick={reload}>Refresh saved</Button></div>
      {error ? <div className="calendar-agenda-error" role="alert">{error}</div> : null}
      {loading ? <div className="calendar-agenda-none">Loading saved agendas…</div> : null}
      {!loading && !error && !listed.length ? <div className="calendar-agenda-none"><EmptyState>No saved agendas yet. Generate an agenda on an upcoming event to save it here.</EmptyState></div> : null}
      {listed.map((record) => <SavedAgendaRow key={record.draftKey} record={record} events={events} open={record.draftKey === openKey} onToggle={() => setOpenKey((current) => current === record.draftKey ? null : record.draftKey)} />)}
      {open ? <MeetingAgendaDraftPanel key={open.draftKey} draftKey={open.draftKey} sourceId={open.sourceId} canGenerate={agendaDraftCanGenerate(open, events)} knownMeetingIds={knownMeetingIds} onOpenMeeting={onOpenMeeting} onOpenSettings={onOpenSettings} /> : null}
    </section>
  )
}

function SavedAgendaRow({ record, events, open, onToggle }: { record: SavedAgendaDraft; events: CalendarSnapshot['events']; open: boolean; onToggle: () => void }) {
  const event = agendaDraftEvent(record, events)
  const state = event ? 'Event left the upcoming Calendar window. Regeneration is off.' : 'Calendar event unavailable (disconnected or removed). Saved topics stay editable.'
  return (
    <div className="calendar-event">
      <div className="calendar-event-time">{startLabel(record.eventStart)}</div>
      <div className="calendar-event-copy"><strong>{record.title}</strong><span>{record.items.length} saved {record.items.length === 1 ? 'topic' : 'topics'} · updated {timestampLabel(record.updatedAt)} · {record.model || 'model unknown'}{record.reasoningEffort ? ` · ${record.reasoningEffort}` : ''}{record.durable ? '' : ' · not saved yet'}</span><span>{state}</span></div>
      <Button className="compact-action" onClick={onToggle}>{open ? 'Hide' : 'Edit'}</Button>
    </div>
  )
}

async function loadRecords(setRecords: (value: SavedAgendaDraft[]) => void, setError: (value: string) => void, setLoading: (value: boolean) => void): Promise<void> {
  setLoading(true)
  try {
    setRecords(await window.gappd.agenda.list())
    setError('')
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause))
  } finally {
    setLoading(false)
  }
}

function summaryLabel(count: number): string {
  return count === 1 ? '1 saved draft' : `${count} saved drafts`
}

function startLabel(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value || 'Unknown date'
  return parsed.toLocaleDateString()
}

function timestampLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toLocaleString()
}
