import type { AgendaCommunication, CommunicationSource } from './agenda-communication'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { communicationEmails, communicationWindow, communicationJSON } from './agenda-communication.ts'

type Part = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] }
type Message = { id?: string; internalDate?: string; payload?: Part }
const LIMIT = 30

/** Reads messages only. No attachments, remote HTML resources, labels, or read-state changes. */
export async function gmailAgenda(token: string, accountId: string, emails: string[], before: number, fetcher: typeof fetch = fetch): Promise<AgendaCommunication> {
  const invitees = communicationEmails(emails)
  if (!invitees.length) return { sources: [] }
  const { oldest, latest } = communicationWindow(before)
  const request = async (path: string, params: Record<string, string>) => {
    let response: Response
    try {
      response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}?${new URLSearchParams(params)}`, {
        headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
    } catch { throw new Error('Gmail agenda read failed. Check your connection and try again.') }
    if (response.status === 401 || response.status === 403) throw new Error('Gmail agenda access is unavailable. Enable the Gmail API and reconnect with Gmail read access in Calendar settings.')
    if (!response.ok) throw new Error(`Gmail agenda read failed (${response.status}). Try again later.`)
    return communicationJSON(response)
  }
  const query = `after:${oldest} before:${latest} {${invitees.flatMap(email => [`from:${email}`, `to:${email}`, `cc:${email}`, `bcc:${email}`]).join(' ')}}`
  const sources: CommunicationSource[] = []
  const warnings = new Set<string>()
  let pageToken = ''
  const seen = new Set<string>()
  for (let page = 0; page < 5; page++) {
    const result = await request('messages', { q: query, maxResults: String(LIMIT - sources.length), pageToken })
    if (result.messages !== undefined && !Array.isArray(result.messages)) throw new Error('Gmail returned invalid message history. Try again.')
    for (const item of result.messages ?? []) {
      if (typeof item.id !== 'string' || !/^[a-f0-9]{1,32}$/i.test(item.id) || seen.has(item.id)) throw new Error('Gmail returned invalid message history. Try again.')
      seen.add(item.id)
      const message: Message = await request(`messages/${item.id}`, { format: 'full' })
      const time = Number(message.internalDate)
      if (message.id !== item.id || !Number.isFinite(time)) throw new Error('Gmail returned invalid message evidence. Try again.')
      if (time / 1000 < oldest || time / 1000 >= latest) continue
      const header = (name: string) => mimeHeader(message.payload, name)
      const body = plainBody(message.payload)
      // ponytail: plain-text MIME only; add safe HTML extraction if HTML-only mail is needed.
      if (!body) { warnings.add('Some Gmail messages had no readable plain-text body. HTML-only messages and attachments were not read.'); continue }
      const text = `From: ${header('from')}\nTo: ${header('to')}\nSubject: ${header('subject')}\n\n${body}`
      if (Buffer.byteLength(text) > 24000) throw new Error('A Gmail message exceeds the agenda input limit. Prepare this agenda manually; no draft was generated.')
      sources.push({ id: `gmail:${accountId}:${item.id}`, kind: 'gmail', title: `Gmail: ${header('subject') || '(no subject)'}`.slice(0, 1000), startedAt: new Date(time).toISOString(), text })
      if (sources.length >= LIMIT) break
    }
    pageToken = result.nextPageToken ?? ''
    if (typeof pageToken !== 'string' || pageToken.length > 2048) throw new Error('Gmail returned an invalid history page. Try again.')
    if (!pageToken || sources.length >= LIMIT) break
  }
  if (pageToken) warnings.add('Gmail context is limited to 30 recent messages; older messages may resolve these topics.')
  return { sources, warning: [...warnings].join(' ') || undefined }
}

function mimeHeader(part: Part | undefined, name: string): string {
  if (part?.headers !== undefined && (!Array.isArray(part.headers) || part.headers.some(value => !value || typeof value.name !== 'string' || typeof value.value !== 'string'))) {
    throw new Error('Gmail returned invalid MIME headers. No draft was generated.')
  }
  return part?.headers?.find(value => value.name.toLowerCase() === name)?.value ?? ''
}

function plainBody(part?: Part, depth = 0): string {
  if (!part) return ''
  if (depth > 20 || typeof part !== 'object' || (part.parts !== undefined && !Array.isArray(part.parts))) throw new Error('Gmail returned invalid MIME content. No draft was generated.')
  if (part.filename || /^\s*attachment\b/i.test(mimeHeader(part, 'content-disposition'))) return ''
  if (part.mimeType === 'text/plain' && typeof part.body?.data === 'string') return Buffer.from(part.body.data, 'base64url').toString('utf8')
  return (part.parts ?? []).map(child => plainBody(child, depth + 1)).filter(Boolean).join('\n')
}
