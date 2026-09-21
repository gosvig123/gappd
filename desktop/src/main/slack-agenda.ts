import { setTimeout as delay } from 'node:timers/promises'
import type { SlackConnection } from './slack-connection'
import type { AgendaCommunication, CommunicationSource } from './agenda-communication'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { communicationEmails, communicationWindow, communicationJSON } from './agenda-communication.ts'

type Conversation = { id: string; user?: string; name?: string; is_im?: boolean; is_member?: boolean; is_archived?: boolean }
type Message = { ts?: string; text?: string; user?: string; reply_count?: number }
const READ_ERROR = 'Slack agenda read failed. Check the Slack connection and try again.'

export function agendaSlackChannels(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 3 || value.some(id => typeof id !== 'string' || !/^[CG][A-Z0-9]{8,}$/.test(id))) {
    throw new Error('Choose at most three Slack channel IDs (C… or G…) for this agenda.')
  }
  return [...new Set(value as string[])]
}

/** Reads existing DMs and selected memberships; never opens or joins a conversation. */
export async function slackAgenda(connection: SlackConnection, emails: string[], selected: unknown, before: number, fetcher: typeof fetch = fetch): Promise<AgendaCommunication> {
  const channels = agendaSlackChannels(selected)
  const invitees = communicationEmails(emails)
  const identity = await connection.identity()
  if (!identity) {
    if (channels.length) throw new Error('Connect Slack before selecting agenda channels.')
    return { sources: [] }
  }
  const { oldest, latest } = communicationWindow(before)
  return connection.withAccessToken(identity, async (token, assertCurrent) => {
    const warnings = new Set<string>(['Slack context uses up to 15 recent messages per conversation and 15 messages per retrieved thread from the last 30 days. Older messages, older thread roots, and attachments are not covered.'])
    let waitedMs = 0
    const request = async (method: string, params: Record<string, string>, retried = false): Promise<any> => {
      assertCurrent()
      let response: Response
      try {
        response = await fetcher(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
          headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
        })
      } catch { throw new Error(READ_ERROR) }
      assertCurrent()
      const value = await communicationJSON(response).catch(() => null)
      if (response.status === 429 || value?.error === 'ratelimited') {
        const seconds = response.headers.get('retry-after') ?? ''
        const waitMs = /^\d{1,3}$/.test(seconds) ? Number(seconds) * 1000 + 1000 : 0
        if (!retried && waitMs > 0 && waitMs <= 65000 && waitedMs + waitMs <= 600000) {
          waitedMs += waitMs
          await delay(waitMs)
          return request(method, params, true)
        }
        throw new Error(`Slack limited agenda reads. ${/^\d{1,6}$/.test(seconds) ? `Try again in ${seconds} seconds.` : 'Try again later.'} No draft was generated.`)
      }
      if (value?.error === 'users_not_found' && method === 'users.lookupByEmail') return null
      if (value?.error === 'missing_scope') throw new Error('Reconnect Slack to grant agenda access to invitee emails and message history.')
      if (!response.ok || value?.ok !== true) throw new Error(READ_ERROR)
      return value
    }
    const userIds = new Set<string>()
    for (const email of invitees) {
      const result = await request('users.lookupByEmail', { email })
      if (!result) continue
      if (typeof result.user?.id !== 'string' || !/^[UW][A-Z0-9]{8,}$/.test(result.user.id)) throw new Error(READ_ERROR)
      userIds.add(result.user.id)
    }
    const conversations = new Map<string, Conversation>()
    let cursor = ''
    if (userIds.size) {
      for (let page = 0; page < 10; page++) {
        const result = await request('users.conversations', { types: 'im', limit: '200', exclude_archived: 'true', cursor })
        if (!Array.isArray(result.channels)) throw new Error(READ_ERROR)
        for (const channel of result.channels as Conversation[]) {
          if (channel.is_im && userIds.has(channel.user ?? '') && !channel.is_archived) {
            if (!/^D[A-Z0-9]{8,}$/.test(channel.id)) throw new Error(READ_ERROR)
            conversations.set(channel.id, channel)
          }
        }
        const next = result.response_metadata?.next_cursor ?? ''
        if (typeof next !== 'string' || next.length > 2048 || (next && next === cursor)) throw new Error(READ_ERROR)
        cursor = next
        if (!cursor) break
      }
      if (cursor) throw new Error('Slack DM discovery exceeded its page limit. No draft was generated.')
    }
    for (const channel of channels) {
      const result = await request('conversations.info', { channel })
      if (result.channel?.id !== channel || result.channel.is_im || result.channel.is_mpim || result.channel.is_member !== true || result.channel.is_archived) {
        throw new Error('Agenda channels must be active Slack channels you have joined. Check the selected channel IDs.')
      }
      conversations.set(channel, result.channel)
    }
    if (conversations.size > 8) throw new Error('Agenda Slack context exceeds eight conversations. Choose fewer invitees or channels.')
    const sources = new Map<string, CommunicationSource>()
    let threadCount = 0
    for (const channel of conversations.values()) {
      const result = await request('conversations.history', { channel: channel.id, oldest: String(oldest), latest: String(latest), limit: '15' })
      if (!Array.isArray(result.messages)) throw new Error(READ_ERROR)
      for (const message of result.messages as Message[]) {
        addMessage(channel, message)
        if (message.reply_count) {
          if (++threadCount > 12) throw new Error('Slack agenda context exceeds twelve threads. No draft was generated.')
          const replies = await request('conversations.replies', { channel: channel.id, ts: message.ts!, latest: String(latest), limit: '15' })
          if (!Array.isArray(replies.messages)) throw new Error(READ_ERROR)
          for (const reply of replies.messages as Message[]) addMessage(channel, reply)
          if (replies.has_more || replies.response_metadata?.next_cursor) warnings.add('Some Slack threads have more replies than were read; confirm current status in Slack.')
        }
      }
    }
    assertCurrent()
    return { sources: [...sources.values()], warning: conversations.size ? [...warnings].join(' ') : undefined, assertCurrent }

    function addMessage(channel: Conversation, message: Message) {
      if (typeof message.ts !== 'string' || !/^\d{1,12}\.\d{6}$/.test(message.ts)) throw new Error(READ_ERROR)
      const time = Number(message.ts)
      if (time < oldest || time >= latest || !message.text) return
      if (typeof message.text !== 'string' || Buffer.byteLength(message.text) > 24000) throw new Error('A Slack message exceeds the agenda input limit. No draft was generated.')
      const id = `slack:${identity!.teamId}:${channel.id}:${message.ts}`
      sources.set(id, { id, kind: 'slack', title: `Slack: ${channel.is_im ? `DM with ${channel.user}` : `#${channel.name ?? channel.id}`}`, startedAt: new Date(time * 1000).toISOString(), text: `Author: ${message.user ?? 'unknown'}\n${message.text}` })
    }
  })
}
