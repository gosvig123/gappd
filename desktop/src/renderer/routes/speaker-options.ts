import type { CalendarEventSummary } from '../../shared/calendar-contract'

import type { SavedPerson } from '../../shared/participant-contract'
export type { SavedPerson, ParticipantContext } from '../../shared/participant-contract'
export type PersonOption = { value: string; name: string; email?: string; personId?: string; invited?: boolean }

export function personOptions(people: SavedPerson[], event?: CalendarEventSummary): PersonOption[] {
  const options: PersonOption[] = people.map(person => ({ value: person.id, personId: person.id, name: person.name, email: person.email }))
  for (const attendee of event?.attendees ?? []) {
    const saved = options.find(person => person.email?.toLowerCase() === attendee.email.toLowerCase())
    if (saved) saved.invited = true
    else options.push({ value: `attendee:${attendee.email}`, name: attendee.name || attendee.email, email: attendee.email, invited: true })
  }
  return options.sort((left, right) => Number(Boolean(right.invited)) - Number(Boolean(left.invited)) || left.name.localeCompare(right.name))
}
