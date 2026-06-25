import { app, shell } from 'electron'
import { BETA_UPDATE_CHANNEL, DEFAULT_UPDATE_CHANNEL, isUpdateChannel, type UpdateChannel, type UpdateDownloadResult, type UpdateStatus } from '../shared/contracts'
import { downloadUpdateArtifact } from './update-download'
import { selectUpdateRelease, type UpdateContext, type UpdateRelease } from './update-manifest'
import { isNewerVersion, isVersionAtLeast } from './update-version'

const DEFAULT_UPDATE_CHECK_URL = 'https://github.com/gosvig123/gappd/releases/latest/download/latest.json'
const BETA_UPDATE_CHECK_URL = 'https://github.com/gosvig123/gappd/releases/download/beta/latest.json'
const DEFAULT_RELEASE_URL = 'https://github.com/gosvig123/gappd/releases/latest'
const UPDATE_CHECK_URL_ENV = 'GAPPD_UPDATE_CHECK_URL'
const UPDATE_CHANNEL_ENV = 'GAPPD_UPDATE_CHANNEL'
const UPDATE_ACCEPT_HEADER = 'application/vnd.github+json, application/json'
const UPDATE_USER_AGENT = 'gappd-desktop'

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
    const release = await fetchRelease(updateContext())
    if (!release || !isCompatibleRelease(release, currentVersion) || !isNewerVersion(release.version, currentVersion)) return unavailable(currentVersion, release?.version)
    return available(currentVersion, release)
  } catch {
    return unavailable(currentVersion)
  }
}

function available(currentVersion: string, release: UpdateRelease): UpdateStatus {
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
}

async function fetchRelease(context: UpdateContext): Promise<UpdateRelease | null> {
  const response = await fetch(context.sourceUrl, { headers: { Accept: UPDATE_ACCEPT_HEADER, 'User-Agent': UPDATE_USER_AGENT } })
  if (!response.ok) return null
  return selectUpdateRelease(await response.json(), context)
}

function updateContext(): UpdateContext {
  const channel = updateChannel(app.getVersion())
  const sourceUrl = updateCheckUrl(channel)
  return {
    arch: process.arch,
    channel,
    defaultReleaseUrl: DEFAULT_RELEASE_URL,
    defaultUpdateUrl: DEFAULT_UPDATE_CHECK_URL,
    platform: process.platform,
    sourceUrl,
  }
}

function updateCheckUrl(channel: UpdateChannel): string {
  const rawUrl = process.env[UPDATE_CHECK_URL_ENV]?.trim() || defaultUpdateCheckUrl(channel)
  return httpsUrl(rawUrl, 'Update check URL must use https.')
}

function defaultUpdateCheckUrl(channel: UpdateChannel): string {
  return channel === BETA_UPDATE_CHANNEL ? BETA_UPDATE_CHECK_URL : DEFAULT_UPDATE_CHECK_URL
}

function updateChannel(currentVersion: string): UpdateChannel {
  const rawChannel = process.env[UPDATE_CHANNEL_ENV]?.trim()
  if (isUpdateChannel(rawChannel)) return rawChannel
  return currentVersion.includes('-beta.') ? BETA_UPDATE_CHANNEL : DEFAULT_UPDATE_CHANNEL
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

function isCompatibleRelease(release: UpdateRelease, currentVersion: string): boolean {
  return !release.minVersion || isVersionAtLeast(currentVersion, release.minVersion)
}
