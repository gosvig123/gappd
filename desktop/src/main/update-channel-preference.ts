import { app } from 'electron'
import { BETA_UPDATE_CHANNEL, DEFAULT_UPDATE_CHANNEL, isUpdateChannel, type UpdateChannel } from '../shared/contracts'
import { readPreferences, updatePreferences } from './preferences'

const UPDATE_CHANNEL_ENV = 'GAPPD_UPDATE_CHANNEL'
const BETA_VERSION_MARKER = '-beta.'

export function resolveUpdateChannel(): UpdateChannel {
  const envChannel = envUpdateChannel()
  if (envChannel) return rememberUpdateChannel(envChannel)
  if (isBetaVersion(app.getVersion())) return rememberUpdateChannel(BETA_UPDATE_CHANNEL)
  const stored = readPreferences().data.updateChannel
  return isUpdateChannel(stored) ? stored : DEFAULT_UPDATE_CHANNEL
}

function envUpdateChannel(): UpdateChannel | undefined {
  const rawChannel = process.env[UPDATE_CHANNEL_ENV]?.trim()
  return isUpdateChannel(rawChannel) ? rawChannel : undefined
}

function rememberUpdateChannel(channel: UpdateChannel): UpdateChannel {
  try {
    if (readPreferences().data.updateChannel !== channel) {
      updatePreferences((current) => ({ ...current, updateChannel: channel }))
    }
  } catch {}
  return channel
}

function isBetaVersion(version: string): boolean {
  return version.includes(BETA_VERSION_MARKER)
}
