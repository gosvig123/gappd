import { useEffect, useState } from 'react'
import type { CalendarParticipant } from '../../shared/calendar-contract'
import type { MeetingDetail, MeetingListItem } from '../../shared/contracts'
import { SpeakerRow, type Speaker } from '../components/meeting/speaker-row'
import { personOptions } from '../components/meeting/speaker-options'
import { Button } from '../components/ui'
import { useSpeakerAudio } from '../hooks/use-speaker-audio'
import type { AppView } from '../lib/app-view'
import { shortDate } from '../lib/person-activity'
import '../components/meeting/speaker-labels.css'

const QUEUE_DAYS = 30
const MEETINGS_PER_PAGE = 3
type QueueMeeting = { meeting: MeetingListItem; speakers: Speaker[] }

/**
 * Speakers without a Person in the Meetings of the last 30 days, newest Meeting first.
 * Naming one makes that Meeting's notes again, so older Meetings stay out of the queue.
 */
export function SpeakerQueue({ view }: { view: AppView }) {
  const queue = speakerQueue(view)
  const [shown, setShown] = useState(MEETINGS_PER_PAGE)
  const contacts = useCalendarContacts()
  if (!queue.length) return null
  const speakers = queue.reduce((count, item) => count + item.speakers.length, 0)
  const suggestions = queue.reduce((count, item) => count + item.speakers.filter((speaker) => speaker.suggestedPersonId).length, 0)
  return (
    <details className="speaker-labels app-speaker-queue">
      <summary>Name speakers <span>{speakers} {speakers === 1 ? 'speaker' : 'speakers'} in {queue.length} {queue.length === 1 ? 'Meeting' : 'Meetings'} from the last {QUEUE_DAYS} days{suggestions ? ` · ${suggestions} voice ${suggestions === 1 ? 'suggestion' : 'suggestions'} to check` : ''}</span></summary>
      <div className="speaker-label-content">
        <p className="speaker-label-hint">Play a short clip, then choose a person. Naming a speaker updates that Meeting's transcript and makes its notes again.</p>
        {queue.slice(0, shown).map((item) => <QueueMeetingSpeakers key={item.meeting.id} item={item} view={view} contacts={contacts} />)}
        {queue.length > shown ? <Button className="compact-action app-speaker-queue-more" onClick={() => setShown(shown + MEETINGS_PER_PAGE)}>Show more Meetings ({queue.length - shown})</Button> : null}
      </div>
    </details>
  )
}

function QueueMeetingSpeakers({ item, view, contacts }: { item: QueueMeeting; view: AppView; contacts: CalendarParticipant[] }) {
  const audio = useSpeakerAudio(item.meeting.id)
  const options = personOptions(view.people, view.meetingEvents.get(item.meeting.id), contacts)
  // A label can save a new Person, so the People list must reload too.
  const labeled = (next: MeetingDetail) => { view.actions.meetingUpdated(next); void window.gappd.meetings.people().then(view.actions.peopleChanged).catch(console.error) }
  return (
    <section className="app-speaker-queue-meeting" aria-label={item.meeting.title || 'Untitled meeting'}>
      <h3><button type="button" className="app-link" onClick={() => view.actions.openMeeting(item.meeting.id)}>{item.meeting.title || 'Untitled meeting'}</button> <span>{shortDate(item.meeting.startedAt)}</span></h3>
      {item.speakers.map((speaker) => (
        <SpeakerRow key={`${item.meeting.id}:${speaker.key}:${speaker.suggestedPersonId ?? ''}`} excerpt={audio.excerpt?.speakerKey === speaker.key ? audio.excerpt : null} meetingId={item.meeting.id} speaker={speaker} options={options} playing={audio.playing === speaker.key} play={(index) => void audio.play(speaker.key, index)} stop={audio.stop} onUpdated={labeled} />
      ))}
      {audio.error ? <p role="alert" className="app-error">{audio.error}</p> : null}
    </section>
  )
}

/** Unlabeled remote speakers per recent Meeting; speakers with a voice suggestion come first. */
function speakerQueue(view: Pick<AppView, 'meetings' | 'meetingDetails'>, now = Date.now()): QueueMeeting[] {
  const since = now - QUEUE_DAYS * 24 * 60 * 60 * 1000
  return view.meetings
    .filter((meeting) => new Date(meeting.startedAt).getTime() >= since)
    .map((meeting) => ({ meeting, speakers: (view.meetingDetails.get(meeting.id)?.speakers ?? []).filter((speaker) => !speaker.personId && speaker.key !== 'You') }))
    .map((item) => ({ ...item, speakers: [...item.speakers].sort((left, right) => Number(Boolean(right.suggestedPersonId)) - Number(Boolean(left.suggestedPersonId))) }))
    .filter((item) => item.speakers.length > 0)
}

function useCalendarContacts(): CalendarParticipant[] {
  const [contacts, setContacts] = useState<CalendarParticipant[]>([])
  useEffect(() => {
    let active = true
    void window.gappd.googleCalendar.contacts().then((next) => { if (active) setContacts(next) }).catch(() => { if (active) setContacts([]) })
    return () => { active = false }
  }, [])
  return contacts
}
