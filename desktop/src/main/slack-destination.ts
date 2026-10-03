import type { SlackSendDestination } from '../shared/slack-contract'

export const SLACK_CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]{6,}$/
export const SLACK_MESSAGE_TS_PATTERN = /^\d{10}\.\d{6}$/

const APP_HOST = 'app.slack.com'
const WORKSPACE_HOST = /^[a-z0-9][a-z0-9-]*\.slack\.com$/
const CLIENT_TEAM_ID = /^[TE][A-Z0-9]{6,}$/
const ARCHIVES_PATH = /^\/archives\/([^/]+)(?:\/p(\d{16}))?$/
const CLIENT_PATH = /^\/client\/([^/]+)\/([^/]+)(?:\/thread\/([^/]+))?$/
const QUERY_PARAMS = new Set(['thread_ts', 'cid'])

const INVALID_DESTINATION = 'Enter a Slack channel ID or a Slack channel or thread link.'
const INVALID_THREAD = 'That Slack link has an invalid thread timestamp. Copy the link from Slack again.'
const FOREIGN_WORKSPACE = 'That link belongs to a different Slack workspace. Paste a link from the connected workspace.'

export function parseSlackDestination(value: unknown, connectedTeamId: string): SlackSendDestination {
  if (typeof value !== 'string') throw new Error(INVALID_DESTINATION)
  const input = value.trim()
  if (!input) throw new Error(INVALID_DESTINATION)
  if (SLACK_CHANNEL_ID_PATTERN.test(input)) return { channelId: input, threadTs: null }
  return parseSlackUrl(input, connectedTeamId)
}

export function slackDestinationLabel(destination: SlackSendDestination): string {
  return destination.threadTs
    ? `channel ${destination.channelId}, thread reply to ${destination.threadTs}`
    : `channel ${destination.channelId}`
}

function parseSlackUrl(input: string, connectedTeamId: string): SlackSendDestination {
  const url = parseUrl(input)
  if (url.username || url.password || url.port || url.hash) throw new Error(INVALID_DESTINATION)
  if (url.hostname === APP_HOST) return parseClientUrl(url, connectedTeamId)
  if (!WORKSPACE_HOST.test(url.hostname)) throw new Error(INVALID_DESTINATION)
  return parseArchivesUrl(url)
}

function parseUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new Error(INVALID_DESTINATION) }
  if (url.protocol !== 'https:') throw new Error(INVALID_DESTINATION)
  return url
}

function parseArchivesUrl(url: URL): SlackSendDestination {
  requireKnownQuery(url)
  const match = ARCHIVES_PATH.exec(url.pathname)
  const channelId = match?.[1] ?? ''
  if (!match || !SLACK_CHANNEL_ID_PATTERN.test(channelId)) throw new Error(INVALID_DESTINATION)
  const queryCid = url.searchParams.get('cid')
  if (queryCid !== null && queryCid !== channelId) throw new Error(INVALID_DESTINATION)
  const threadTs = url.searchParams.get('thread_ts') ?? messageTimestamp(match[2])
  return { channelId, threadTs: threadTs === null ? null : requireThreadTs(threadTs) }
}

function parseClientUrl(url: URL, connectedTeamId: string): SlackSendDestination {
  requireKnownQuery(url)
  const match = CLIENT_PATH.exec(url.pathname)
  const teamId = match?.[1] ?? ''
  const channelId = match?.[2] ?? ''
  if (!match || !CLIENT_TEAM_ID.test(teamId) || !SLACK_CHANNEL_ID_PATTERN.test(channelId)) throw new Error(INVALID_DESTINATION)
  if (teamId !== connectedTeamId) throw new Error(FOREIGN_WORKSPACE)
  const thread = match[3]
  const pathTs = thread ? clientThreadTs(thread, channelId) : null
  const queryTs = url.searchParams.get('thread_ts')
  const cid = url.searchParams.get('cid')
  if (cid !== null && cid !== channelId) throw new Error(INVALID_DESTINATION)
  if (queryTs !== null) requireThreadTs(queryTs)
  if (pathTs && queryTs !== null && pathTs !== queryTs) throw new Error(INVALID_THREAD)
  return { channelId, threadTs: queryTs ?? pathTs }
}

function requireKnownQuery(url: URL): void {
  for (const key of url.searchParams.keys()) {
    if (url.searchParams.getAll(key).length !== 1) throw new Error(INVALID_DESTINATION)
    if (!QUERY_PARAMS.has(key)) throw new Error(INVALID_DESTINATION)
  }
}

function requireThreadTs(value: string): string {
  if (!SLACK_MESSAGE_TS_PATTERN.test(value)) throw new Error(INVALID_THREAD)
  return value
}

function clientThreadTs(thread: string, channelId: string): string {
  if (!thread.startsWith(`${channelId}-`)) throw new Error(INVALID_THREAD)
  return requireThreadTs(thread.slice(channelId.length + 1))
}

/** Slack message links compress the timestamp to `p<seconds><microseconds>`. */
function messageTimestamp(digits: string | undefined): string | null {
  return digits ? `${digits.slice(0, 10)}.${digits.slice(10)}` : null
}
