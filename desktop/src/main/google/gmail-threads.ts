import type { GmailThread } from '../../shared/calendar-contract'

const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_THREAD_LIMIT = 20
const PARALLEL_READS = 5
const REQUEST_TIMEOUT_MS = 15_000
const THREAD_ID = /^[a-f0-9]{1,32}$/i
const PLAIN_EMAIL = /^[^\s@"(){}]+@[^\s@"(){}]+$/
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

type Header = { name?: string; value?: string }
type Message = { internalDate?: string; snippet?: string; payload?: { headers?: Header[] } }

/**
 * Reads the latest threads that one account exchanged with an email address: headers and
 * Gmail's short snippet only, never bodies or attachments, and nothing is stored or changed.
 */
export async function fetchGmailThreads(accessToken: string, accountEmail: string, personEmail: string, fetcher: typeof fetch = fetch): Promise<GmailThread[]> {
  if (!PLAIN_EMAIL.test(personEmail)) throw new Error(`Cannot search Gmail for "${personEmail}". Edit the Person's email and try again.`)
  const request = (path: string, params: [string, string][]) => gmailJSON(fetcher, accessToken, `${GMAIL_URL}/${path}?${new URLSearchParams(params)}`)
  const address = `"${personEmail}"`
  const list = await request('threads', [['q', `from:${address} OR to:${address} OR cc:${address}`], ['maxResults', String(GMAIL_THREAD_LIMIT)]]) as { threads?: { id?: string }[] }
  const ids = (list.threads ?? []).flatMap((thread) => typeof thread.id === 'string' && THREAD_ID.test(thread.id) ? [thread.id] : [])
  const threads: GmailThread[] = []
  for (let index = 0; index < ids.length; index += PARALLEL_READS) {
    const batch = ids.slice(index, index + PARALLEL_READS).map(async (id) => {
      const thread = await request(`threads/${id}`, [['format', 'metadata'], ['metadataHeaders', 'Subject'], ['metadataHeaders', 'From'], ['fields', 'id,messages(internalDate,snippet,payload/headers)']]) as { messages?: Message[] }
      return toThread(id, accountEmail, thread.messages ?? [])
    })
    threads.push(...(await Promise.all(batch)).flatMap((thread) => thread ? [thread] : []))
  }
  return threads
}

export function gmailThreadUrl(accountEmail: string, threadId: string): string {
  if (!THREAD_ID.test(threadId) || !PLAIN_EMAIL.test(accountEmail)) throw new Error('This Gmail thread link is invalid. Reload the Person and try again.')
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(accountEmail)}#all/${threadId}`
}

function toThread(threadId: string, accountEmail: string, messages: Message[]): GmailThread | null {
  const latest = messages.at(-1)
  if (!latest) return null
  const date = new Date(Number(latest.internalDate))
  return {
    accountEmail, threadId,
    subject: header(messages[0], 'Subject') || '(no subject)',
    from: header(latest, 'From'),
    date: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
    snippet: decodeEntities(latest.snippet ?? ''),
    messageCount: messages.length,
  }
}

function header(message: Message | undefined, name: string): string {
  return message?.payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? ''
}

// Gmail returns snippets HTML-escaped; the renderer shows them as text.
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, name: string) => ENTITIES[name])
}

async function gmailJSON(fetcher: typeof fetch, accessToken: string, url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch { throw new Error('Gmail read failed. Check your connection and try again.') }
  if (response.status === 401 || response.status === 403) throw new Error('Gmail access was refused. In Settings → Google Calendar, add Gmail access to this account again.')
  if (!response.ok) throw new Error(`Gmail read failed (${response.status}). Try again later.`)
  return response.json()
}
