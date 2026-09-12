import { shell } from 'electron'
import type { SlackConnectionStatus } from '../shared/slack-contract'
import { createSecureStore } from './electron-secure-store'
import { serviceConfig } from './service-config'
import { SlackConnection } from './slack-connection'
import type { SlackTokenSet } from './slack-oauth'

const CONNECTION_STORE_FILE = 'slack-connection.enc'
let instance: SlackConnection | null = null

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

async function describeSlackConnection(connection: SlackConnection | null): Promise<SlackConnectionStatus> {
  if (!connection) return { configured: false, connected: false, teamId: '', userId: '', refreshExpiresAt: null }
  const tokens = await connection.tokens()
  return {
    configured: true,
    connected: Boolean(tokens),
    teamId: tokens?.teamId ?? '',
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
