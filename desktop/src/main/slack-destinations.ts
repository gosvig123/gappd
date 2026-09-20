// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection } from './slack-connection.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SLACK_CHANNEL_ID_PATTERN } from './slack-destination.ts'
import type { SlackDestinationOption, SlackDestinationPage } from '../shared/slack-contract'

const READ_ERROR = 'Could not load Slack destinations. Try again or paste a Slack link.'
const RECONNECT = 'Reconnect Slack to grant access to channels, conversations, and member names.'

/** Read one page from the connected user's memberships. Never opens or joins conversations. */
export async function listSlackDestinations(connection: SlackConnection, cursor: unknown = '', fetcher: typeof fetch = fetch): Promise<SlackDestinationPage> {
  if (typeof cursor !== 'string' || cursor.length > 2048 || /[\x00-\x20\x7f]/.test(cursor)) throw new Error('Invalid Slack page. Reload the destination list.')
  const identity = await connection.identity()
  if (!identity) throw new Error('Slack is not connected. Connect Slack to choose a destination.')
  return connection.withAccessToken(identity, async (token, assertCurrent) => {
    const request = async (method: 'users.conversations' | 'users.info', params: Record<string, string>) => {
      assertCurrent()
      let response: Response
      try {
        response = await fetcher(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
          headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
        })
      } catch { throw new Error(READ_ERROR) }
      const value = await response.json().catch(() => null)
      assertCurrent()
      if (response.status === 429) {
        const delay = response.headers.get('retry-after') || ''
        throw new Error(`Slack is rate limiting destination requests. ${/^\d{1,6}$/.test(delay) ? `Try again in ${delay} seconds.` : 'Wait a moment and try again.'}`)
      }
      if (value?.error === 'missing_scope') throw new Error(RECONNECT)
      if (['invalid_auth', 'token_expired', 'token_revoked', 'account_inactive', 'not_authed'].includes(value?.error)) throw new Error('Slack authorization expired. Reconnect Slack to load destinations.')
      if (!response.ok || value?.ok !== true) throw new Error(READ_ERROR)
      return value
    }
    const page = await request('users.conversations', { types: 'public_channel,private_channel,im,mpim', exclude_archived: 'true', limit: '100', cursor })
    const nextCursor = page.response_metadata?.next_cursor ?? ''
    if (!Array.isArray(page.channels) || typeof nextCursor !== 'string' || nextCursor.length > 2048 || /[\x00-\x20\x7f]/.test(nextCursor) || (cursor && nextCursor === cursor)) throw new Error(READ_ERROR)
    const destinations: SlackDestinationOption[] = []
    for (const channel of page.channels) {
      if (!channel || typeof channel.id !== 'string' || !SLACK_CHANNEL_ID_PATTERN.test(channel.id)) throw new Error(READ_ERROR)
      if (channel.is_archived || channel.is_user_deleted) continue
      const kind = channel.is_im ? 'dm' : channel.is_mpim ? 'group-dm' : channel.is_private ? 'private-channel' : 'channel'
      let label = typeof channel.name === 'string' && channel.name.trim() ? channel.name.trim() : channel.id
      if (kind === 'dm' && typeof channel.user === 'string' && /^[UW][A-Z0-9]{8,}$/.test(channel.user)) {
        const { user } = await request('users.info', { user: channel.user })
        label = [user?.profile?.display_name, user?.real_name, user?.name].find(value => typeof value === 'string' && value.trim())?.trim() || channel.id
      }
      destinations.push({ channelId: channel.id, label, kind })
    }
    assertCurrent()
    return { destinations, nextCursor }
  })
}
