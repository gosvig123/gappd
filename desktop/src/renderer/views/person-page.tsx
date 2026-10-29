import { useEffect, useState } from 'react'
import type { CalendarEventSummary } from '../../shared/calendar-contract'
import type { PersonActionItem, SavedPerson } from '../../shared/participant-contract'
import { AgendaButton, AgendaPanel } from '../components/agenda'
import { PersonEmail } from '../components/person-email'
import { errorText, PersonEditor, PersonMerge } from '../components/person-forms'
import { Button } from '../components/ui'
import type { AppView } from '../lib/app-view'
import { initialsOf, personEvents, personMeetings, shortDate } from '../lib/person-activity'
import { readableName } from '../lib/person-identity'

type Props = { person: SavedPerson; view: AppView; canEmail: boolean; onBack: () => void }
type Change = 'edit' | 'merge' | 'email' | null

/** One Person: their next Calendar events, the action items they own, and their Meetings. */
export function PersonPage({ person, view, canEmail, onBack }: Props) {
  const [change, setChange] = useState<Change>(null)
  const meetings = personMeetings(person, view)
  const events = personEvents(person, view.calendar)
  const actions = usePersonActionItems(person.id, view)
  const firstName = readableName(person).split(/\s+/)[0]
  const done = (people: SavedPerson[]) => { view.actions.peopleChanged(people); setChange(null) }
  return (
    <div className="app-stack">
      <button type="button" className="app-link app-person-back" onClick={onBack}>← People</button>
      <header className="app-person app-person-page-head">
        <span className="app-avatar" aria-hidden="true">{initialsOf(readableName(person))}</span>
        <div className="app-person-copy">
          <h1 className="ui-title">{person.name}</h1>
          <span>{[person.email ?? 'No email saved', meetingCount(meetings.length), meetings[0] ? `Last ${shortDate(meetings[0].startedAt)}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="app-person-actions">
          {canEmail && person.email ? <Button className="compact-action" aria-expanded={change === 'email'} onClick={() => setChange(change === 'email' ? null : 'email')}>Email</Button> : null}
          <Button className="compact-action" onClick={() => setChange('edit')}>Edit</Button>
          {view.people.length > 1 ? <Button className="compact-action" onClick={() => setChange('merge')}>Merge…</Button> : null}
        </span>
        {change === 'edit' ? <PersonEditor person={person} onDone={done} onCancel={() => setChange(null)} /> : null}
        {change === 'merge' ? <PersonMerge person={person} people={view.people} onDone={done} onCancel={() => setChange(null)} /> : null}
        {change === 'email' && person.email ? <PersonEmail name={person.name} email={person.email} /> : null}
      </header>
      {events.length ? (
        <section className="app-block" aria-label="Next">
          <div className="app-block-head"><h2>Next</h2></div>
          <ul className="app-person-list">
            {events.map((event) => <NextEventRow key={event.sourceId} event={event} view={view} />)}
          </ul>
        </section>
      ) : null}
      <section className="app-block" aria-label="Action items">
        <div className="app-block-head"><h2>Action items</h2><span className="app-block-note">From the notes of their Meetings</span></div>
        {actions.error ? <p role="alert" className="app-error">{actions.error}</p> : null}
        {actions.items === null && !actions.error ? <p className="app-block-note app-person-empty">Loading action items…</p> : null}
        {actions.items?.length === 0 ? <p className="app-block-note app-person-empty">No Meeting notes give {firstName} an action item.</p> : null}
        {actions.items?.length ? (
          <ul className="app-person-list">
            {actions.items.map((item, index) => (
              <li key={`${item.meetingId}:${index}`} className="app-person-action">
                <span>{item.task}</span>
                <span className="app-block-note">
                  {item.deadline ? `Due ${item.deadline} · ` : ''}
                  <button type="button" className="app-link" onClick={() => view.actions.openMeeting(item.meetingId)}>{item.meetingTitle || 'Untitled meeting'}</button>
                  {` · ${shortDate(item.startedAt)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="app-block" aria-label="Meetings">
        <div className="app-block-head"><h2>Meetings</h2><span className="app-block-note">{meetingCount(meetings.length)}</span></div>
        {meetings.length ? (
          <ul className="app-person-list">
            {meetings.map((meeting) => (
              <li key={meeting.id} className="app-recent-row">
                <span className="app-recent-time">{shortDate(meeting.startedAt)}</span>
                <button type="button" className="app-recent-title" onClick={() => view.actions.openMeeting(meeting.id)}>{meeting.title || 'Untitled meeting'}</button>
              </li>
            ))}
          </ul>
        ) : <p className="app-block-note app-person-empty">No Meeting speaker is labeled as {firstName} yet.</p>}
      </section>
    </div>
  )
}

function NextEventRow({ event, view }: { event: CalendarEventSummary; view: AppView }) {
  const [agendaOpen, setAgendaOpen] = useState(false)
  return (
    <li className="app-recent-row app-person-event">
      <span className="app-recent-time">{shortDate(event.start)}</span>
      <span className="app-person-item-title">{event.title || 'Untitled event'}</span>
      <span className="app-timeline-actions">
        <span className="app-block-note">{eventTime(event)}</span>
        <AgendaButton event={event} view={view} open={agendaOpen} onToggle={() => setAgendaOpen(!agendaOpen)} />
      </span>
      {agendaOpen ? <AgendaPanel event={event} view={view} /> : null}
    </li>
  )
}

/** Notes change when a Meeting is processed again, so the list reloads when any Meeting status changes. */
function usePersonActionItems(personId: string, view: AppView) {
  const [state, setState] = useState<{ items: PersonActionItem[] | null; error: string | null }>({ items: null, error: null })
  const revision = view.meetings.map((meeting) => meeting.status.updatedAt).join('|')
  useEffect(() => {
    let active = true
    window.gappd.meetings.personActionItems(personId)
      .then((items) => { if (active) setState({ items, error: null }) })
      .catch((cause) => { if (active) setState({ items: null, error: `Could not load action items: ${errorText(cause)}` }) })
    return () => { active = false }
  }, [personId, revision])
  return state
}

function eventTime(event: CalendarEventSummary): string {
  if (event.allDay) return 'All day'
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${time.format(new Date(event.start))}–${time.format(new Date(event.end))}`
}

function meetingCount(count: number): string {
  return `${count} ${count === 1 ? 'Meeting' : 'Meetings'}`
}
