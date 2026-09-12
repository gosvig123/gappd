// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { SLACK_SEND_TEXT_MAX_LENGTH, type SlackSendDestination } from '../shared/slack-contract.ts'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const EMPTY_MESSAGE = 'Enter a message to send.'
const TOO_LONG = `Message is too long. Shorten it to ${SLACK_SEND_TEXT_MAX_LENGTH} characters or fewer.`
const TOO_LONG_ESCAPED = 'Message is too long after Slack special characters are escaped. Remove some <, >, or & characters, then review it again.'

export function validateSlackMessageText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(EMPTY_MESSAGE)
  if (value.length > SLACK_SEND_TEXT_MAX_LENGTH) throw new Error(TOO_LONG)
  if (escapeSlackText(value).length > SLACK_SEND_TEXT_MAX_LENGTH) throw new Error(TOO_LONG_ESCAPED)
  return value
}

/** Plain text only: escaping stops `<@user>`, `<!channel>`, and links from activating. */
export function escapeSlackText(text: string): string {
  return text.replace(/[&<>]/g, (character) => ESCAPES[character] ?? character)
}

export function slackPostMessageBody(destination: SlackSendDestination, text: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    channel: destination.channelId,
    text: escapeSlackText(text),
    mrkdwn: false,
    unfurl_links: false,
    unfurl_media: false,
  }
  if (destination.threadTs) {
    body.thread_ts = destination.threadTs
    body.reply_broadcast = false
  }
  return body
}
