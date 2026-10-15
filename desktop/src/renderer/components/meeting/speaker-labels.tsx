import { useEffect, useState } from 'react'
import type { CalendarEventSummary, CalendarParticipant } from '../../../shared/calendar-contract'
import type { MeetingDetail } from '../../../shared/contracts'
import { useSpeakerAudio } from '../../hooks/use-speaker-audio'
import { personOptions, type SavedPerson } from './speaker-options'
import { SpeakerRow } from './speaker-row'
import './speaker-labels.css'

type Props = { meeting: MeetingDetail; event?: CalendarEventSummary; onUpdated: (meeting: MeetingDetail) => void }

/** The Meeting's Calendar event comes from the header picker; its invitees are listed first. */
export function SpeakerLabels({ meeting, event, onUpdated }: Props) {
  const { people, contacts, error } = useParticipantOptions(meeting)
  const audio = useSpeakerAudio(meeting.id)
  if (!meeting.speakers?.length) return null
  const options = personOptions(people, event, contacts)
  const suggested = meeting.speakers.filter(speaker => !speaker.personId && speaker.suggestedPersonId).length
  return <details className="speaker-labels" id="meeting-speaker-labels"><summary>People in this meeting <span>{meeting.speakers.length} speakers · {suggested ? `${suggested} voice ${suggested === 1 ? 'suggestion' : 'suggestions'} to check` : 'Listen and label'}</span></summary><div className="speaker-label-content"><p className="speaker-label-hint">Play a short clip, then choose a person. {event ? 'Invitees of the Calendar event come first, but confirm who actually spoke. ' : ''}Confirmed labels can help fill future speaker names on this Mac. Auto-filled labels can be corrected or cleared.</p>{meeting.speakers.map(speaker => <SpeakerRow key={`${meeting.id}:${speaker.key}:${speaker.personId ?? ''}:${speaker.identityOrigin ?? ''}:${speaker.suggestedPersonId ?? ''}`} excerpt={audio.excerpt?.speakerKey === speaker.key ? audio.excerpt : null} meetingId={meeting.id} speaker={speaker} options={options} playing={audio.playing === speaker.key} play={index => void audio.play(speaker.key, index)} stop={audio.stop} onUpdated={onUpdated} />)}{error || audio.error ? <p role="alert">{error || audio.error}</p> : null}</div></details>
}

function useParticipantOptions(meeting: MeetingDetail) {
  const [people, setPeople] = useState<SavedPerson[]>([]), [contacts, setContacts] = useState<CalendarParticipant[]>([]), [error, setError] = useState<string | null>(null)
  const assignedPeople = meeting.speakers?.map(speaker => speaker.personId).join(',')
  useEffect(() => {
    let active = true
    void window.gappd.meetings.people().then(saved => { if (active) { setPeople(saved); setError(null) } }).catch(cause => { if (active) setError(String(cause)) })
    void window.gappd.googleCalendar.contacts().then(next => { if (active) setContacts(next) }).catch(() => { if (active) setContacts([]) })
    return () => { active = false }
  }, [meeting.id, assignedPeople])
  return { people, contacts, error }
}
