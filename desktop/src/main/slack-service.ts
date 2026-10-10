import { shell } from 'electron'
import type { SlackConnectionStatus, SlackSendResult, SlackSendReview } from '../shared/slack-contract'
import { createSecureStore } from './electron-secure-store'
import { serviceConfig } from './service-config'
import { SlackConnection } from './slack-connection'
import { confirmSlackSend } from './slack-confirmation'
import type { SlackTokenSet } from './slack-oauth'
import { SlackSendService } from './slack-send'
import { listSlackDestinations } from './slack-destinations'
import { slackAgenda, agendaSlackChannels } from './slack-agenda'
import type { AgendaCommunication, CommunicationPeriod } from './agenda-communication'

const CONNECTION_STORE_FILE = 'slack-connection.enc'
let instance: SlackConnection | null = null
let sendInstance: SlackSendService | null = null

export function slackConnectionStatus(): Promise<SlackConnectionStatus> {
  return describeSlackConnection(connection())
}

export async function connectSlack(): Promise<SlackConnectionStatus> {
  const active = requireSlackConnection()
  await active.connect()
  return describeSlackConnection(active)
}

export async function disconnectSlack(): Promise<SlackConnectionStatus> {
  const active = requireSlackConnection()
  await active.disconnect()
  return describeSlackConnection(active)
}

export async function slackAgendaCommunication(emails: string[], selected: unknown, before: CommunicationPeriod): Promise<AgendaCommunication> {
  const channels = agendaSlackChannels(selected)
  const active = connection()
  if (!active) {
    if (channels.length) throw new Error('Slack is not configured for this build.')
    return { sources: [] }
  }
  return slackAgenda(active, emails, channels, before)
}

export function slackDestinations(cursor: unknown = '') {
  return listSlackDestinations(requireSlackConnection(), cursor)
}

export function reviewSlackMessage(input: unknown): Promise<SlackSendReview> {
  return slackSendService().review(input)
}

export function sendSlackMessage(reviewId: unknown): Promise<SlackSendResult> {
  return slackSendService().send(reviewId)
}

function slackSendService(): SlackSendService {
  const active = requireSlackConnection()
  sendInstance ||= new SlackSendService(active, { confirm: confirmSlackSend })
  return sendInstance
}

async function describeSlackConnection(connection: SlackConnection | null): Promise<SlackConnectionStatus> {
  if (!connection) return { configured: false, connected: false, teamId: '', teamName: '', userId: '', refreshExpiresAt: null }
  const tokens = await connection.tokens()
  return {
    configured: true,
    connected: Boolean(tokens),
    teamId: tokens?.teamId ?? '',
    teamName: tokens?.teamName ?? '',
    userId: tokens?.userId ?? '',
    refreshExpiresAt: tokens?.refreshExpiresAt ?? null,
  }
}

function requireSlackConnection(): SlackConnection {
  const active = connection()
  if (!active) throw new Error('Slack is not configured for this build.')
  return active
}

function connection(): SlackConnection | null {
  const clientId = serviceConfig().slackClientId
  if (!clientId) return null
  instance ||= new SlackConnection(clientId, createSecureStore<SlackTokenSet>(CONNECTION_STORE_FILE), {
    openExternal: (url) => shell.openExternal(url),
  })
  return instance
}
