import { useEffect, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import { useRequestGate } from '../hooks/request-gate'
import { useSpeakerAudio } from '../hooks/use-speaker-audio'
import { personOptions, type ParticipantContext, type SavedPerson } from './speaker-options'
import { SpeakerRow } from './speaker-row'
import './speaker-labels.css'

type Props = { meeting: MeetingDetail; onUpdated: (meeting: MeetingDetail) => void }

export function SpeakerLabels({ meeting, onUpdated }: Props) {
  const { people, context, error, link } = useParticipantOptions(meeting)
  const audio = useSpeakerAudio(meeting.id)
  if (!meeting.speakers?.length) return null
  const options = personOptions(people, context.event)
  return <details className="speaker-labels" id="meeting-speaker-labels"><summary>People in this meeting <span>{meeting.speakers.length} speakers · Listen and label</span></summary><div className="speaker-label-content"><CalendarSource context={context} onLink={link} /><p className="speaker-label-hint">Play a short clip, then choose a person. Saved people are available in future calls.</p>{meeting.speakers.map(speaker => <SpeakerRow key={`${meeting.id}:${speaker.key}:${speaker.personId ?? ''}`} excerpt={audio.excerpt?.speakerKey === speaker.key ? audio.excerpt : null} meetingId={meeting.id} speaker={speaker} options={options} playing={audio.playing === speaker.key} play={index => void audio.play(speaker.key, index)} stop={audio.stop} onUpdated={onUpdated} />)}{error || audio.error ? <p role="alert">{error || audio.error}</p> : null}</div></details>
}

function CalendarSource({ context, onLink }: { context: ParticipantContext; onLink: (id: string) => Promise<void> }) {
  if (!context.event && !context.candidates.length) return <p className="speaker-label-hint">No matching calendar event. Choose a saved person or add someone below.</p>
  return <div className="speaker-calendar-source"><label>Calendar event<select aria-label="Calendar event for participant suggestions" value={context.event?.sourceId ?? ''} onChange={event => void onLink(event.target.value)}><option value="">No calendar event</option>{calendarChoices(context).map(event => <option key={event.sourceId} value={event.sourceId}>{event.title} · {new Date(event.start).toLocaleString()}</option>)}</select></label><span className="speaker-label-hint">Invitees are suggestions; confirm who actually spoke.</span></div>
}

function calendarChoices(context: ParticipantContext) {
  return context.event ? [context.event, ...context.candidates.filter(event => event.sourceId !== context.event?.sourceId)] : context.candidates
}

function useParticipantOptions(meeting: MeetingDetail) {
  const [people, setPeople] = useState<SavedPerson[]>([]), [error, setError] = useState<string | null>(null)
  const calendar = useCalendarContext(meeting.id)
  const assignedPeople = meeting.speakers?.map(speaker => speaker.personId).join(',')
  useEffect(() => {
    let active = true
    void window.gappd.meetings.people().then(saved => { if (active) { setPeople(saved); setError(null) } }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [meeting.id, assignedPeople])
  return { ...calendar, people, error: [error, calendar.error].filter(Boolean).join(' · ') || null }
}

function useCalendarContext(meetingId: string) {
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
  return { context, error, link: (eventSourceId: string) => apply(window.gappd.meetings.linkCalendar({ id: meetingId, eventSourceId })) }
}
