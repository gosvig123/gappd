import { useEffect, useState } from 'react'
import type { CalendarParticipant } from '../../shared/calendar-contract'
import type { AppActions } from '../lib/app-view'
import type { MeetingDetail } from '../../shared/contracts'
import { useRequestGate } from '../hooks/request-gate'
import { useSpeakerAudio } from '../hooks/use-speaker-audio'
import { personOptions, type ParticipantContext, type SavedPerson } from './speaker-options'
import { SpeakerRow } from './speaker-row'
import './speaker-labels.css'

type Props = { meeting: MeetingDetail; onUpdated: (meeting: MeetingDetail) => void; onLinkCalendar: AppActions['linkMeetingCalendar'] }

export function SpeakerLabels({ meeting, onUpdated, onLinkCalendar }: Props) {
  const { people, contacts, context, error, link } = useParticipantOptions(meeting, onLinkCalendar)
  const audio = useSpeakerAudio(meeting.id)
  if (!meeting.speakers?.length) return null
  const options = personOptions(people, context.event, contacts)
  return <details className="speaker-labels" id="meeting-speaker-labels"><summary>People in this meeting <span>{meeting.speakers.length} speakers · Listen and label</span></summary><div className="speaker-label-content"><CalendarSource context={context} onLink={link} /><p className="speaker-label-hint">Play a short clip, then choose a person. Confirmed labels can help fill future speaker names on this Mac. Auto-filled labels can be corrected or cleared.</p>{meeting.speakers.map(speaker => <SpeakerRow key={`${meeting.id}:${speaker.key}:${speaker.personId ?? ''}:${speaker.identityOrigin ?? ''}`} excerpt={audio.excerpt?.speakerKey === speaker.key ? audio.excerpt : null} meetingId={meeting.id} speaker={speaker} options={options} playing={audio.playing === speaker.key} play={index => void audio.play(speaker.key, index)} stop={audio.stop} onUpdated={onUpdated} />)}{error || audio.error ? <p role="alert">{error || audio.error}</p> : null}</div></details>
}

function CalendarSource({ context, onLink }: { context: ParticipantContext; onLink: (id: string) => Promise<void> }) {
  if (!context.event && !context.candidates.length) return <p className="speaker-label-hint">No matching calendar event. Choose a saved person or add someone below.</p>
  return <div className="speaker-calendar-source"><label>Calendar event<select aria-label="Calendar event for participant suggestions" value={context.event?.sourceId ?? ''} onChange={event => void onLink(event.target.value)}><option value="">{context.inferenceDisabled ? 'No Calendar event · automatic agenda matching off' : 'No confirmed Calendar event'}</option>{calendarChoices(context).map(event => <option key={event.sourceId} value={event.sourceId}>{event.title} · {new Date(event.start).toLocaleString()}</option>)}</select></label><span className="speaker-label-hint">Invitees are suggestions; confirm who actually spoke.</span>{!context.event && !context.inferenceDisabled ? <button type="button" onClick={() => void onLink('')}>Disable automatic Calendar matching for agendas</button> : null}</div>
}

function calendarChoices(context: ParticipantContext) {
  return context.event ? [context.event, ...context.candidates.filter(event => event.sourceId !== context.event?.sourceId)] : context.candidates
}

function useParticipantOptions(meeting: MeetingDetail, onLinkCalendar: Props['onLinkCalendar']) {
  const [people, setPeople] = useState<SavedPerson[]>([]), [contacts, setContacts] = useState<CalendarParticipant[]>([]), [error, setError] = useState<string | null>(null)
  const calendar = useCalendarContext(meeting.id, onLinkCalendar)
  const assignedPeople = meeting.speakers?.map(speaker => speaker.personId).join(',')
  useEffect(() => {
    let active = true
    void window.gappd.meetings.people().then(saved => { if (active) { setPeople(saved); setError(null) } }).catch(cause => { if (active) setError(String(cause)) })
    void window.gappd.googleCalendar.contacts().then(next => { if (active) setContacts(next) }).catch(() => { if (active) setContacts([]) })
    return () => { active = false }
  }, [meeting.id, assignedPeople])
  return { ...calendar, people, contacts, error: [error, calendar.error].filter(Boolean).join(' · ') || null }
}

function useCalendarContext(meetingId: string, onLinkCalendar: Props['onLinkCalendar']) {
  const [context, setContext] = useState<ParticipantContext>({ candidates: [] }), [error, setError] = useState<string | null>(null)
  const request = useRequestGate()
  const apply = async (pending: Promise<ParticipantContext>) => {
    const generation = request.next()
    try { const next = await pending; if (request.isCurrent(generation)) { setContext(next); setError(null) } }
    catch (cause) { if (request.isCurrent(generation)) setError(String(cause)) }
  }
  useEffect(() => {
    void apply(window.gappd.meetings.participantContext(meetingId))
    return request.cancel
  }, [meetingId])
  return { context, error, link: (eventSourceId: string) => apply(onLinkCalendar({ id: meetingId, eventSourceId })) }
}
