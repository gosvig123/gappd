import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { ParticipantContext } from '../../../shared/participant-contract'
import type { AppActions } from '../../lib/app-view'
import { eventTimeRange } from '../../lib/app-view'
import { useRequestGate } from '../../hooks/request-gate'

/** Linking "no event" also turns off automatic Calendar matching for this Meeting. */
const NOT_AN_EVENT = 'none'

export type MeetingCalendar = { context: ParticipantContext; error: string | null; busy: boolean; link: (eventSourceId: string) => Promise<void> }

/** The Meeting's Calendar event. The header picker and the speaker suggestions read the same state. */
export function useMeetingCalendar(meetingId: string | null, onLinkCalendar: AppActions['linkMeetingCalendar']): MeetingCalendar {
  const [context, setContext] = useState<ParticipantContext>({ candidates: [] })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const request = useRequestGate()
  const apply = async (pending: Promise<ParticipantContext>) => {
    const generation = request.next()
    try { const next = await pending; if (request.isCurrent(generation)) { setContext(next); setError(null) } }
    catch (cause) { if (request.isCurrent(generation)) setError(String(cause)) }
  }
  useEffect(() => {
    setContext({ candidates: [] }); setError(null)
    if (meetingId) void apply(window.gappd.meetings.participantContext(meetingId))
    return request.cancel
  }, [meetingId])
  const link = async (eventSourceId: string) => {
    if (!meetingId) return
    setBusy(true)
    try { await apply(onLinkCalendar({ id: meetingId, eventSourceId })) } finally { setBusy(false) }
  }
  return { context, error, busy, link }
}

/** Shown under the Meeting title only when a Calendar event could belong to it. */
export function MeetingEventPicker({ calendar }: { calendar: MeetingCalendar }) {
  const { context, error, busy, link } = calendar
  if (!context.event && !context.candidates.length) return null
  const value = context.event?.sourceId ?? (context.inferenceDisabled ? NOT_AN_EVENT : '')
  const choices = context.event ? [context.event, ...context.candidates.filter(event => event.sourceId !== context.event?.sourceId)] : context.candidates
  return (
    <div className="app-panel-event">
      <CalendarDays aria-hidden="true" />
      <select aria-label="Calendar event" value={value} disabled={busy} onChange={event => void link(event.target.value === NOT_AN_EVENT ? '' : event.target.value)}>
        {value === '' ? <option value="">Choose Calendar event…</option> : null}
        {choices.map(event => <option key={event.sourceId} value={event.sourceId}>{event.title} · {eventTimeRange(event)}</option>)}
        <option value={NOT_AN_EVENT}>Not a Calendar event</option>
      </select>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}
