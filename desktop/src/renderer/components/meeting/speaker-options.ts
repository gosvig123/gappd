import type { CalendarEventSummary, CalendarParticipant } from '../../../shared/calendar-contract'

import type { SavedPerson } from '../../../shared/participant-contract'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { isEmailName, nameFromEmail } from '../../lib/person-identity.ts'
export type { SavedPerson, ParticipantContext } from '../../../shared/participant-contract'
export type PersonOption = { value: string; name: string; email?: string; personId?: string; invited?: boolean; saved?: boolean }

export function personOptions(people: SavedPerson[], event?: CalendarEventSummary, contacts: CalendarParticipant[] = []): PersonOption[] {
  const options: PersonOption[] = people.map(person => ({ value: person.id, personId: person.id, name: person.name, email: person.email, saved: true }))
  for (const attendee of event?.attendees ?? []) appendContact(options, attendee, true)
  for (const contact of contacts) appendContact(options, contact, false)
  return options.sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name))
}

// Keeps the options whose name or email holds every typed word, ignoring case and accents, in their ranked order.
export function matchPersonOptions(options: PersonOption[], query: string): PersonOption[] {
  const words = searchText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return options
  return options.filter(option => {
    const text = searchText(`${option.name} ${option.email ?? ''}`)
    return words.every(word => text.includes(word))
  })
}

function searchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// This Meeting's invitees first, then people the user saved, then contacts seen on other Calendar events.
function rank(option: PersonOption): number {
  if (option.invited) return 0
  return option.saved ? 1 : 2
}

function appendContact(options: PersonOption[], contact: CalendarParticipant, invited: boolean): void {
  const email = contact.email.toLowerCase()
  const saved = options.find(option => option.email?.toLowerCase() === email)
  // A saved Person's real name wins; a Person saved under only an email shows the Calendar name. The Person ID, not this name, is sent on assignment.
  if (saved) { if (invited) saved.invited = true; if (isEmailName(saved.name) && contact.name) saved.name = contact.name; return }
  options.push({ value: `attendee:${contact.email}`, name: contact.name || nameFromEmail(contact.email), email: contact.email, invited })
}
