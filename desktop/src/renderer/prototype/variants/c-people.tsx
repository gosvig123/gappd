import type { SavedPerson } from '../../../shared/participant-contract'
import { EmptyState } from '../../components/ui'
import type { PrototypeView } from '../contract'

type PersonRow = { person: SavedPerson; meetings: number; lastSeen?: string }

export function DeckPeople({ view }: { view: PrototypeView }) {
  const rows = view.people.map((person) => personRow(person, view)).sort((left, right) => right.meetings - left.meetings)
  return (
    <div className="vc-stack">
      <header className="vc-section-head">
        <p className="proto-eyebrow">Saved identities</p>
        <h1 className="proto-title">People</h1>
        <p className="vc-section-sub">{rows.length} saved {rows.length === 1 ? 'person' : 'people'} · assigning a Person to a Meeting speaker names their turns and refreshes the summary</p>
      </header>
      {rows.length ? (
        <ul className="vc-people">
          {rows.map((row) => (
            <li key={row.person.id} className="vc-person">
              <span className="vc-avatar" aria-hidden="true">{initialsOf(row.person.name)}</span>
              <div className="vc-person-copy">
                <strong>{row.person.name}</strong>
                <span>{row.person.email ?? 'No email saved'}</span>
              </div>
              <span className="vc-person-count">{row.meetings} {row.meetings === 1 ? 'Meeting' : 'Meetings'}</span>
              <span className="vc-person-seen">{row.lastSeen ? `Last ${row.lastSeen}` : 'Not labeled yet'}</span>
            </li>
          ))}
        </ul>
      ) : <EmptyState>No saved People yet. Label a Meeting speaker to save them here.</EmptyState>}
    </div>
  )
}

function personRow(person: SavedPerson, view: PrototypeView): PersonRow {
  const matches = [...view.meetingDetails.values()].filter((detail) => detail.speakers.some((speaker) => speaker.personId === person.id || speaker.name === person.name))
  const latest = view.meetings.find((meeting) => matches.some((detail) => detail.id === meeting.id))
  return { person, meetings: matches.length, lastSeen: latest ? shortDate(latest.startedAt) : undefined }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?'
}

function shortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
