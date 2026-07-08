import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { BETA_UPDATE_CHANNEL, DEFAULT_UPDATE_CHANNEL, isUpdateChannel, type UpdateChannel } from '../shared/contracts'

const UPDATE_CHANNEL_ENV = 'GAPPD_UPDATE_CHANNEL'
const UPDATE_CHANNEL_PREFERENCE_FILE = 'update-channel.json'
const BETA_VERSION_MARKER = '-beta.'

type StoredUpdateChannel = { channel: UpdateChannel }

export function resolveUpdateChannel(): UpdateChannel {
  const envChannel = envUpdateChannel()
  if (envChannel) return rememberUpdateChannel(envChannel)
  if (isBetaVersion(app.getVersion())) return rememberUpdateChannel(BETA_UPDATE_CHANNEL)
  return readStoredUpdateChannel()?.channel ?? DEFAULT_UPDATE_CHANNEL
}

function envUpdateChannel(): UpdateChannel | undefined {
  const rawChannel = process.env[UPDATE_CHANNEL_ENV]?.trim()
  return isUpdateChannel(rawChannel) ? rawChannel : undefined
}

function rememberUpdateChannel(channel: UpdateChannel): UpdateChannel {
  writeStoredUpdateChannel(channel)
  return channel
}

function isBetaVersion(version: string): boolean {
  return version.includes(BETA_VERSION_MARKER)
}

function readStoredUpdateChannel(): StoredUpdateChannel | undefined {
  try {
    return parseStoredUpdateChannel(fs.readFileSync(preferencePath(), 'utf8'))
  } catch {
    return undefined
  }
}

function parseStoredUpdateChannel(raw: string): StoredUpdateChannel | undefined {
  try {
    return storedUpdateChannel(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function storedUpdateChannel(value: unknown): StoredUpdateChannel | undefined {
  if (!isRecord(value)) return undefined
  const channel = value.channel
  if (typeof channel !== 'string' || !isUpdateChannel(channel)) return undefined
  return { channel }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function writeStoredUpdateChannel(channel: UpdateChannel): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(preferencePath(), JSON.stringify({ channel }), 'utf8')
  } catch {}
}

function preferencePath(): string {
  return path.join(app.getPath('userData'), UPDATE_CHANNEL_PREFERENCE_FILE)
}
