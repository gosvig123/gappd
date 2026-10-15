export const SLACK_SEND_TEXT_MAX_LENGTH = 4000

export type SlackConnectionStatus = {
  configured: boolean
  connected: boolean
  teamId: string
  teamName: string
  userId: string
  refreshExpiresAt: number | null
}

export type SlackDestinationOption = {
  channelId: string
  label: string
  kind: 'channel' | 'private-channel' | 'dm' | 'group-dm'
}

export type SlackDestinationPage = {
  destinations: SlackDestinationOption[]
  nextCursor: string
}

export type SlackSendReviewInput = {
  destination: string
  text: string
}

export type SlackSendDestination = {
  channelId: string
  /** Parent message timestamp when the destination is a thread reply. */
  threadTs: string | null
}

/** What the main process holds for one reviewed message. Sending takes only the id. */
export type SlackSendReview = {
  id: string
  destination: SlackSendDestination
  teamId: string
  userId: string
  text: string
}

export type SlackSendFailure = {
  status: 'failed'
  message: string
  outcome: 'not-sent' | 'unknown'
  retryAfterSeconds: number | null
}

export type SlackSendResult =
  | { status: 'sent'; channelId: string; ts: string; messageLink: string }
  | { status: 'cancelled' }
  | SlackSendFailure
