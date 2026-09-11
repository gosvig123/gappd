import type { CalendarEventSummary, CalendarParticipant } from '../../shared/calendar-contract'

import type { SavedPerson } from '../../shared/participant-contract'
export type { SavedPerson, ParticipantContext } from '../../shared/participant-contract'
export type PersonOption = { value: string; name: string; email?: string; personId?: string; invited?: boolean; saved?: boolean }

export function personOptions(people: SavedPerson[], event?: CalendarEventSummary, contacts: CalendarParticipant[] = []): PersonOption[] {
  const options: PersonOption[] = people.map(person => ({ value: person.id, personId: person.id, name: person.name, email: person.email, saved: true }))
  for (const attendee of event?.attendees ?? []) appendContact(options, attendee, true)
  for (const contact of contacts) appendContact(options, contact, false)
  return options.sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name))
}

// This Meeting's invitees first, then people the user saved, then contacts seen on other Calendar events.
function rank(option: PersonOption): number {
  if (option.invited) return 0
  return option.saved ? 1 : 2
}

function appendContact(options: PersonOption[], contact: CalendarParticipant, invited: boolean): void {
  const email = contact.email.toLowerCase()
  const saved = options.find(option => option.email?.toLowerCase() === email)
  if (saved) { if (invited) saved.invited = true; return }
  options.push({ value: `attendee:${contact.email}`, name: contact.name || contact.email, email: contact.email, invited })
}
