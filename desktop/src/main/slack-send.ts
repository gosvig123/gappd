import { randomUUID } from 'node:crypto'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection, type SlackAccountIdentity } from './slack-connection.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SLACK_CHANNEL_ID_PATTERN, SLACK_MESSAGE_TS_PATTERN, parseSlackDestination } from './slack-destination.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { slackPostMessageBody, validateSlackMessageText } from './slack-message.ts'
import type { SlackSendDestination, SlackSendResult, SlackSendReview } from '../shared/slack-contract'

export const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage'
const REQUEST_TIMEOUT_MS = 15_000
const SAFE_ERROR = /^[a-z][a-z_]{0,59}$/
const UNCONFIRMED_ERRORS = new Set(['fatal_error', 'internal_error'])
const UNKNOWN_DELIVERY = 'Gappd could not confirm whether Slack received the message. Check Slack before you try again.'
const RECONNECT_MESSAGE = 'Slack authorization expired. Reconnect Slack, then review the message again.'

const SLACK_ERROR_MESSAGES: Record<string, string> = {
  missing_scope: 'Slack did not grant the chat:write scope for this connection. Reconnect Slack, then review the message again.',
  not_authed: RECONNECT_MESSAGE,
  invalid_auth: RECONNECT_MESSAGE,
  token_expired: RECONNECT_MESSAGE,
  token_revoked: RECONNECT_MESSAGE,
  account_inactive: RECONNECT_MESSAGE,
  invalid_refresh_token: RECONNECT_MESSAGE,
  not_in_channel: 'Your Slack account is not in that conversation. Join it in Slack, then review the message again.',
  channel_not_found: 'Slack could not find that channel or conversation. Check the destination link or channel ID.',
  is_archived: 'That Slack conversation is archived. Choose another destination.',
  msg_too_long: 'Slack rejected the message as too long. Shorten it, then review it again.',
  rate_limited: 'Slack is rate limiting messages. Wait a moment, then review the message again.',
  thread_not_found: 'Slack could not find that thread. Copy the link from Slack again.',
  invalid_arguments: 'Slack rejected the request. Check the destination and message, then review it again.',
}

export type SlackSendConfirmation = {
  destination: SlackSendDestination
  teamId: string
  userId: string
  text: string
}

export type SlackSendDependencies = {
  confirm(review: SlackSendConfirmation): Promise<boolean>
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
  reviewId?: () => string
}

type PendingSend = { id: string; destination: SlackSendDestination; text: string; identity: SlackAccountIdentity }

/**
 * Holds one reviewed message at a time. Sending accepts only the review id, so
 * the renderer cannot change the message, destination, account, or thread
 * between the review, the confirmation dialog, and the fixed Slack request.
 */
export class SlackSendService {
  private readonly connection: SlackConnection
  private readonly dependencies: SlackSendDependencies
  private pending: PendingSend | null = null
  private sending = false

  constructor(connection: SlackConnection, dependencies: SlackSendDependencies) {
    this.connection = connection
    this.dependencies = dependencies
  }

  async review(input: unknown): Promise<SlackSendReview> {
    const identity = await this.connection.identity()
    if (!identity) throw new Error('Slack is not connected.')
    const destination = parseSlackDestination(readField(input, 'destination'), identity.teamId)
    const text = validateSlackMessageText(readField(input, 'text'))
    const id = (this.dependencies.reviewId || randomUUID)()
    this.pending = { id, destination, text, identity }
    return { id, destination, teamId: identity.teamId, userId: identity.userId, text }
  }

  async send(reviewId: unknown): Promise<SlackSendResult> {
    if (this.sending) throw new Error('A Slack message is already being sent. Wait for it to finish.')
    const review = this.consume(reviewId)
    this.sending = true
    try {
      await this.connection.requireIdentity(review.identity)
      if (!(await this.dependencies.confirm(confirmationOf(review)))) return { status: 'cancelled' }
      return await this.connection.withAccessToken(review.identity, (token, assertCurrent) => this.post(token, review, assertCurrent))
    } finally {
      this.sending = false
    }
  }

  private consume(reviewId: unknown): PendingSend {
    const review = this.pending
    this.pending = null
    if (typeof reviewId !== 'string' || !review || review.id !== reviewId) throw new Error('Review the message before sending, then confirm it.')
    return review
  }

  private async post(token: string, review: PendingSend, assertCurrent: () => void): Promise<SlackSendResult> {
    assertCurrent()
    let response: Response
    try {
      response = await (this.dependencies.fetcher || fetch)(SLACK_POST_MESSAGE_URL, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(slackPostMessageBody(review.destination, review.text)),
        signal: AbortSignal.timeout(this.dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS),
      })
    } catch { return unknownDelivery() }
    return this.readOutcome(response)
  }

  private async readOutcome(response: Response): Promise<SlackSendResult> {
    const value: unknown = await response.json().catch(() => null)
    if (response.status === 429) return rateLimited(response, this.now())
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unknownDelivery()
    const envelope = value as Record<string, unknown>
    if (typeof envelope.ok !== 'boolean' || response.status >= 500) return unknownDelivery()
    if (!envelope.ok) return failedExchange(envelope)
    if (response.status !== 200) return unknownDelivery()
    return sentResult(envelope)
  }

  private now(): number {
    return (this.dependencies.now || Date.now)()
  }
}

function readField(input: unknown, key: 'destination' | 'text'): unknown {
  return input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined
}

function confirmationOf(review: PendingSend): SlackSendConfirmation {
  return { destination: review.destination, teamId: review.identity.teamId, userId: review.identity.userId, text: review.text }
}

function failed(message: string, retryAfterSeconds: number | null = null): SlackSendResult {
  return { status: 'failed', message, outcome: 'not-sent', retryAfterSeconds }
}

function unknownDelivery(): SlackSendResult {
  return unconfirmed(UNKNOWN_DELIVERY)
}

function unconfirmed(message: string): SlackSendResult {
  return { status: 'failed', message, outcome: 'unknown', retryAfterSeconds: null }
}

function failedExchange(value: Record<string, unknown>): SlackSendResult {
  if (typeof value.error !== 'string' || !SAFE_ERROR.test(value.error)) return unknownDelivery()
  const code = value.error
  if (UNCONFIRMED_ERRORS.has(code)) return unconfirmed(`Slack reported ${code}. The message may have been sent; check Slack before you try again.`)
  return failed(SLACK_ERROR_MESSAGES[code] || `Slack rejected the message (${code}).`)
}

/** Success needs more than `ok`: a send with no channel and ts cannot be confirmed. */
function sentResult(value: Record<string, unknown>): SlackSendResult {
  const channelId = stringValue(value.channel)
  const ts = stringValue(value.ts)
  if (!channelId || !ts || !SLACK_CHANNEL_ID_PATTERN.test(channelId) || !SLACK_MESSAGE_TS_PATTERN.test(ts)) {
    return unconfirmed('Slack accepted the message but returned no message reference. Check Slack before you try again.')
  }
  return { status: 'sent', channelId, ts, messageLink: `https://slack.com/app_redirect?channel=${channelId}&message_ts=${ts}` }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function rateLimited(response: Response, now: number): SlackSendResult {
  const seconds = parseRetryAfter(response.headers.get('retry-after'), now)
  const wait = seconds === null ? '' : ` Try again in about ${seconds} seconds.`
  return failed(`Slack is rate limiting messages.${wait}`, seconds)
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null
  const text = value.trim()
  if (/^\d+$/.test(text)) return Number(text)
  const date = Date.parse(text)
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000))
}
