import type { SavedPerson } from '../../shared/participant-contract'

/** True when a Person's name is only an email address, as saved from a Calendar invitee without a display name. */
export function isEmailName(name: string): boolean {
  return name.includes('@')
}

/** A readable name from an email address: margarita.vallejo@example.com → Margarita Vallejo. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.split('+')[0] ?? ''
  const words = local.split(/[._-]+/).filter(Boolean)
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || email
}

/** The name to show and suggest for a Person whose saved name may be an email address. */
export function readableName(person: SavedPerson): string {
  return isEmailName(person.name) ? nameFromEmail(person.name) : person.name
}

/** The name to show for a Calendar invitee: their People name when it is a real name, then the Calendar name, then a name from the email. */
export function contactName(contact: { email: string; name?: string }, people: SavedPerson[]): string {
  const email = contact.email.toLowerCase()
  const saved = people.find((person) => person.email?.toLowerCase() === email && !isEmailName(person.name))
  return saved?.name || contact.name || nameFromEmail(contact.email)
}

export type DuplicatePair = { id: string; first: SavedPerson; second: SavedPerson }

/**
 * Pairs of People that are probably one person: the same readable name, and not two
 * different emails (two emails mean two Calendar identities, so only the user can merge them).
 */
export function likelyDuplicates(people: SavedPerson[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = []
  for (const [index, first] of people.entries()) {
    for (const second of people.slice(index + 1)) {
      if (first.email && second.email) continue
      if (nameKey(first) !== nameKey(second)) continue
      pairs.push({ id: [first.id, second.id].sort().join(':'), first, second })
    }
  }
  return pairs
}

/**
 * The pair in merge order: the Person to keep first. The kept record is the fuller identity: one
 * with an email, then a real name, then a capitalized name, so "Robert · robert@…" outlives "robert".
 */
export function mergeOrder(pair: DuplicatePair): [kept: SavedPerson, merged: SavedPerson] {
  return identityRank(pair.second) > identityRank(pair.first) ? [pair.second, pair.first] : [pair.first, pair.second]
}

/** The values a merge of two People starts with: the better-written real name, and the one saved email. */
export function mergeDefaults(kept: SavedPerson, merged: SavedPerson): { name: string; email: string } {
  const names = [kept.name, merged.name].filter((name) => !isEmailName(name))
  const name = names.find(hasCapital) ?? names[0] ?? readableName(kept)
  return { name, email: kept.email || merged.email || '' }
}

function identityRank(person: SavedPerson): number {
  return (person.email ? 4 : 0) + (isEmailName(person.name) ? 0 : 2) + (hasCapital(person.name) ? 1 : 0)
}

function hasCapital(name: string): boolean {
  return name !== name.toLowerCase()
}

function nameKey(person: SavedPerson): string {
  return readableName(person).toLowerCase().replace(/\s+/g, ' ').trim()
}
