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

/** The values a merge of two People starts with: a real name over an email, and the one saved email. */
export function mergeDefaults(kept: SavedPerson, merged: SavedPerson): { name: string; email: string } {
  const name = !isEmailName(kept.name) ? kept.name : !isEmailName(merged.name) ? merged.name : readableName(kept)
  return { name, email: kept.email || merged.email || '' }
}

function nameKey(person: SavedPerson): string {
  return readableName(person).toLowerCase().replace(/\s+/g, ' ').trim()
}
