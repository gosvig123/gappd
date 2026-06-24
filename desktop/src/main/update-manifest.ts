import type { UpdateChannel } from '../shared/contracts'
import { normalizeVersion } from './update-version'

const MANIFEST_SCHEMA_V2 = 2

export type UpdateContext = {
  arch: NodeJS.Architecture
  channel: UpdateChannel
  defaultReleaseUrl: string
  defaultUpdateUrl: string
  platform: NodeJS.Platform
  sourceUrl: string
}

export type UpdateRelease = {
  version: string
  releaseUrl: string
  downloadUrl?: string
  sha256?: string
  channel?: UpdateChannel
  minVersion?: string
  name?: string
}

type JsonRecord = Record<string, unknown>
type UpdateAsset = { url: string; sha256?: string }

export function selectUpdateRelease(payload: unknown, context: UpdateContext): UpdateRelease | null {
  if (!isRecord(payload)) return null
  if (payload.schema === MANIFEST_SCHEMA_V2) return selectVersionedRelease(payload, context)
  return parseLegacyRelease(payload, context)
}

function selectVersionedRelease(payload: JsonRecord, context: UpdateContext): UpdateRelease | null {
  const channels = recordField(payload, 'channels')
  const channel = channels ? recordField(channels, context.channel) : null
  const release = channel ? recordField(channel, 'release') : null
  if (!channel || !release) return null
  return buildRelease(release, channel, context)
}

function buildRelease(release: JsonRecord, channel: JsonRecord, context: UpdateContext): UpdateRelease | null {
  const rawVersion = textField(release, 'version') ?? textField(release, 'tag_name')
  if (!rawVersion) return null
  const assets = recordField(release, 'assets')
  const asset = selectAsset(assets, context)
  if (assets && !asset && !textField(release, 'downloadUrl')) return null
  return {
    version: normalizeVersion(rawVersion),
    releaseUrl: releaseUrlField(release, context),
    downloadUrl: asset?.url ?? textField(release, 'downloadUrl') ?? undefined,
    sha256: asset?.sha256 ?? textField(release, 'sha256') ?? undefined,
    channel: context.channel,
    minVersion: optionalVersion(textField(release, 'minVersion') ?? textField(channel, 'minVersion')),
    name: textField(release, 'name') ?? textField(channel, 'name') ?? undefined,
  }
}

function parseLegacyRelease(payload: JsonRecord, context: UpdateContext): UpdateRelease | null {
  const rawVersion = textField(payload, 'version') ?? textField(payload, 'tag_name')
  const channel = textField(payload, 'channel')
  if (!rawVersion || !matchesChannel(channel, context.channel)) return null
  return {
    version: normalizeVersion(rawVersion),
    releaseUrl: releaseUrlField(payload, context),
    downloadUrl: textField(payload, 'downloadUrl') ?? undefined,
    sha256: textField(payload, 'sha256') ?? undefined,
    channel: context.channel,
    minVersion: optionalVersion(textField(payload, 'minVersion')),
    name: textField(payload, 'name') ?? undefined,
  }
}

function selectAsset(assets: JsonRecord | null, context: UpdateContext): UpdateAsset | null {
  if (!assets) return null
  for (const key of assetKeys(context)) {
    const asset = parseAsset(assets[key])
    if (asset) return asset
  }
  return null
}

function assetKeys(context: UpdateContext): string[] {
  return [`${context.platform}-${context.arch}`, `${context.platform}-universal`, context.platform]
}

function parseAsset(value: unknown): UpdateAsset | null {
  if (typeof value === 'string') return stringAsset(value)
  if (!isRecord(value)) return null
  const url = textField(value, 'url') ?? textField(value, 'downloadUrl')
  return url ? { url, sha256: textField(value, 'sha256') ?? undefined } : null
}

function stringAsset(value: string): UpdateAsset | null {
  const url = value.trim()
  return url ? { url } : null
}

function releaseUrlField(payload: JsonRecord, context: UpdateContext): string {
  return textField(payload, 'releaseUrl') ?? textField(payload, 'notesUrl') ?? textField(payload, 'html_url') ?? fallbackReleaseUrl(context)
}

function fallbackReleaseUrl(context: UpdateContext): string {
  return context.sourceUrl === context.defaultUpdateUrl ? context.defaultReleaseUrl : context.sourceUrl
}

function matchesChannel(value: string | null, channel: UpdateChannel): boolean {
  return !value || value === channel
}

function optionalVersion(version: string | null): string | undefined {
  return version ? normalizeVersion(version) : undefined
}

function recordField(payload: JsonRecord, key: string): JsonRecord | null {
  const value = payload[key]
  return isRecord(value) ? value : null
}

function textField(payload: JsonRecord, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}
