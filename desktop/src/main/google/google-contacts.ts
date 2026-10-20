import type { CalendarParticipant } from '../../shared/calendar-contract'

const CONNECTIONS_URL = 'https://people.googleapis.com/v1/people/me/connections'
// Command arguments carry the import, so the count stays well below the macOS argument limit.
const MAX_CONTACTS = 3000
const PAGE_SIZE = 1000
const REQUEST_TIMEOUT_MS = 15_000

type Field = { value?: string; displayName?: string; metadata?: { primary?: boolean } }
type ContactsPage = { connections?: { names?: Field[]; emailAddresses?: Field[] }[]; nextPageToken?: string }

/** Reads the saved contacts of one account: the primary name and email of each contact that has an email. */
export async function fetchGoogleContacts(accessToken: string, fetcher: typeof fetch = fetch): Promise<CalendarParticipant[]> {
  const contacts: CalendarParticipant[] = []
  let pageToken = ''
  do {
    const url = new URL(CONNECTIONS_URL)
    url.search = new URLSearchParams({ personFields: 'names,emailAddresses', pageSize: String(PAGE_SIZE), ...(pageToken ? { pageToken } : {}) }).toString()
    let response: Response
    try {
      response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch { throw new Error('Google Contacts read failed. Check your connection and try again.') }
    if (response.status === 401 || response.status === 403) throw new Error('Google Contacts access was refused. In Settings → Google Calendar, add Contacts access to this account again.')
    if (!response.ok) throw new Error(`Google Contacts read failed (${response.status}). Try again later.`)
    const page = await response.json() as ContactsPage
    for (const person of page.connections ?? []) {
      const email = primary(person.emailAddresses)?.value?.trim()
      if (!email) continue
      const name = primary(person.names)?.displayName?.trim()
      contacts.push(name ? { email, name } : { email })
    }
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && contacts.length < MAX_CONTACTS)
  return contacts.slice(0, MAX_CONTACTS)
}

function primary(fields: Field[] | undefined): Field | undefined {
  return fields?.find((field) => field.metadata?.primary) ?? fields?.[0]
}
