import { app, shell } from 'electron'
import type { UpdateDownloadResult, UpdateStatus } from '../shared/contracts'
import { downloadUpdateArtifact } from './update-download'

const DEFAULT_UPDATE_CHECK_URL = 'https://github.com/gosvig123/gappd/releases/latest/download/latest.json'
const DEFAULT_RELEASE_URL = 'https://github.com/gosvig123/gappd/releases/latest'
const UPDATE_CHECK_URL_ENV = 'GAPPD_UPDATE_CHECK_URL'
const UPDATE_ACCEPT_HEADER = 'application/vnd.github+json, application/json'
const UPDATE_USER_AGENT = 'gappd-desktop'

type ReleaseInfo = {
  version: string
  releaseUrl: string
  downloadUrl?: string
  sha256?: string
  channel?: string
  minVersion?: string
  name?: string
}
type ParsedVersion = { parts: [number, number, number]; preRelease: string | null }

let latestUpdateStatus: UpdateStatus | null = null

export async function getUpdateStatus(): Promise<UpdateStatus> {
  latestUpdateStatus = await resolveUpdateStatus()
  return latestUpdateStatus
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  return getUpdateStatus()
}

export async function openUpdatePage(): Promise<void> {
  const status = await availableUpdateStatus()
  await shell.openExternal(externalUpdateUrl(status.releaseUrl), { activate: true })
}

export async function downloadUpdate(): Promise<UpdateDownloadResult> {
  const status = await availableUpdateStatus()
  if (!status.downloadUrl) throw new Error('Update download failed: manifest has no downloadUrl. Open the release page and download manually.')
  return downloadUpdateArtifact({ url: status.downloadUrl, sha256: status.sha256, version: status.latestVersion })
}

async function resolveUpdateStatus(): Promise<UpdateStatus> {
  const currentVersion = app.getVersion()
  try {
    const release = await fetchRelease(updateCheckUrl())
    if (!release || !isCompatibleRelease(release, currentVersion) || !isNewerVersion(release.version, currentVersion)) return unavailable(currentVersion, release?.version)
    return {
      available: true,
      currentVersion,
      latestVersion: release.version,
      releaseUrl: release.releaseUrl,
      downloadUrl: release.downloadUrl,
      sha256: release.sha256,
      channel: release.channel,
      name: release.name,
    }
  } catch {
    return unavailable(currentVersion)
  }
}

async function fetchRelease(url: string): Promise<ReleaseInfo | null> {
  const response = await fetch(url, { headers: { Accept: UPDATE_ACCEPT_HEADER, 'User-Agent': UPDATE_USER_AGENT } })
  if (!response.ok) return null
  return parseRelease(await response.json(), url)
}

function parseRelease(payload: unknown, sourceUrl: string): ReleaseInfo | null {
  if (!isRecord(payload)) return null
  const rawVersion = textField(payload, 'version') ?? textField(payload, 'tag_name')
  if (!rawVersion) return null
  const releaseUrl = releaseUrlField(payload) ?? fallbackReleaseUrl(sourceUrl)
  return {
    version: normalizeVersion(rawVersion),
    releaseUrl,
    downloadUrl: textField(payload, 'downloadUrl') ?? undefined,
    sha256: textField(payload, 'sha256') ?? undefined,
    channel: textField(payload, 'channel') ?? undefined,
    minVersion: normalizeOptionalVersion(textField(payload, 'minVersion')),
    name: textField(payload, 'name') ?? undefined,
  }
}

function releaseUrlField(payload: Record<string, unknown>): string | null {
  return textField(payload, 'releaseUrl') ?? textField(payload, 'html_url')
}

function updateCheckUrl(): string {
  const rawUrl = process.env[UPDATE_CHECK_URL_ENV]?.trim() || DEFAULT_UPDATE_CHECK_URL
  return httpsUrl(rawUrl, 'Update check URL must use https.')
}

function fallbackReleaseUrl(sourceUrl: string): string {
  return sourceUrl === DEFAULT_UPDATE_CHECK_URL ? DEFAULT_RELEASE_URL : sourceUrl
}

async function availableUpdateStatus(): Promise<Extract<UpdateStatus, { available: true }>> {
  const status = latestUpdateStatus?.available ? latestUpdateStatus : await getUpdateStatus()
  if (!status.available) throw new Error('No update is available. Check for updates again and retry.')
  return status
}

function unavailable(currentVersion: string, latestVersion?: string): UpdateStatus {
  return latestVersion ? { available: false, currentVersion, latestVersion } : { available: false, currentVersion }
}

function externalUpdateUrl(rawUrl: string): string {
  return httpsUrl(rawUrl, 'Update URL must use https.')
}

function httpsUrl(rawUrl: string, message: string): string {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error(message)
  return url.toString()
}

function isCompatibleRelease(release: ReleaseInfo, currentVersion: string): boolean {
  return !release.minVersion || isVersionAtLeast(currentVersion, release.minVersion)
}

function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseVersion(latestVersion)
  const current = parseVersion(currentVersion)
  return Boolean(latest && current && compareVersions(latest, current) > 0)
}

function isVersionAtLeast(version: string, minimumVersion: string): boolean {
  const parsedVersion = parseVersion(version)
  const parsedMinimum = parseVersion(minimumVersion)
  return Boolean(parsedVersion && parsedMinimum && compareVersions(parsedVersion, parsedMinimum) >= 0)
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  const core = compareVersionParts(left.parts, right.parts)
  if (core !== 0) return core
  return comparePreRelease(left.preRelease, right.preRelease)
}

function compareVersionParts(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function comparePreRelease(left: string | null, right: string | null): number {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return comparePreReleaseParts(left.split('.'), right.split('.'))
}

function comparePreReleaseParts(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const result = comparePreReleasePart(left[index], right[index])
    if (result !== 0) return result
  }
  return 0
}

function comparePreReleasePart(left?: string, right?: string): number {
  if (!left) return right ? -1 : 0
  if (!right) return 1
  const leftNumber = numericIdentifier(left)
  const rightNumber = numericIdentifier(right)
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber)
  if (leftNumber !== null) return -1
  if (rightNumber !== null) return 1
  return left.localeCompare(right)
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], preRelease: match[4] ?? null }
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

function normalizeOptionalVersion(version: string | null): string | undefined {
  return version ? normalizeVersion(version) : undefined
}

function numericIdentifier(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null
}

function textField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
