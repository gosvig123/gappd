import { app, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import { BETA_UPDATE_CHANNEL, type UpdateStatus } from '../shared/contracts'
import { RECORDING_STATUS_IDLE } from '../shared/meeting-recording-workflow'
import { createObservableState } from './observable-state'
import { getRecordingState } from './state'
import { resolveUpdateChannel } from './update-channel-preference'

const DEFAULT_RELEASE_URL = 'https://github.com/gosvig123/gappd/releases/latest'
const FORCE_DEV_UPDATE_ENV = 'GAPPD_FORCE_DEV_AUTO_UPDATE'
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const FEED_BETA_CHANNEL = 'beta'

let configured = false
let silentErrors = false
let checkTimer: NodeJS.Timeout | null = null
let checkPromise: Promise<UpdateStatus> | null = null

const updateState = createObservableState<UpdateStatus>(idleStatus())

export const onUpdateStatusChange = updateState.subscribe
export const getUpdateStatus = updateState.get

export function startAutoUpdateChecks(): void {
  if (!autoUpdatesEnabled()) return
  configureAutoUpdater()
  void checkForUpdate({ silent: true })
  if (!checkTimer) checkTimer = setInterval(() => void checkForUpdate({ silent: true }), UPDATE_CHECK_INTERVAL_MS)
}

export function stopAutoUpdateChecks(): void {
  if (!checkTimer) return
  clearInterval(checkTimer)
  checkTimer = null
}

export async function checkForUpdate(options: { silent?: boolean } = {}): Promise<UpdateStatus> {
  if (!autoUpdatesEnabled()) return setIdle()
  configureAutoUpdater()
  if (checkInProgress()) return getUpdateStatus()
  if (checkPromise) return checkPromise
  checkPromise = runUpdateCheck(Boolean(options.silent)).finally(() => { checkPromise = null })
  return checkPromise
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!autoUpdatesEnabled()) return handleUpdateError(new Error('auto updates are unavailable for this build'))
  configureAutoUpdater()
  if (getUpdateStatus().phase === 'downloaded') return getUpdateStatus()
  if (getUpdateStatus().phase !== 'available') return checkForUpdate()
  try {
    setStatus({ phase: 'downloading', available: true, progress: 0 })
    await autoUpdater.downloadUpdate()
    return getUpdateStatus()
  } catch (error) {
    return handleUpdateError(error)
  }
}

export async function installAndRestart(): Promise<UpdateStatus> {
  const blocked = installBlockedMessage()
  if (blocked) throw new Error(blocked)
  if (getUpdateStatus().phase !== 'downloaded') throw new Error('Update install failed: no downloaded update is ready. Check for updates and retry.')
  setStatus({ phase: 'installing', available: true })
  autoUpdater.quitAndInstall(false, true)
  return getUpdateStatus()
}

export async function openUpdatePage(): Promise<void> {
  await shell.openExternal(getUpdateStatus().releaseUrl ?? DEFAULT_RELEASE_URL, { activate: true })
}

function configureAutoUpdater(): void {
  if (configured) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = resolveUpdateChannel() === BETA_UPDATE_CHANNEL
  if (autoUpdater.allowPrerelease) autoUpdater.channel = FEED_BETA_CHANNEL
  if (process.env[FORCE_DEV_UPDATE_ENV] === '1') autoUpdater.forceDevUpdateConfig = true
  autoUpdater.on('checking-for-update', () => setStatus({ phase: 'checking', available: false, error: undefined, progress: undefined }))
  autoUpdater.on('update-not-available', (info) => setIdle(info))
  autoUpdater.on('update-available', (info) => setAvailable(info))
  autoUpdater.on('download-progress', (progress) => setDownloading(progress))
  autoUpdater.on('update-downloaded', (event) => setDownloaded(event))
  autoUpdater.on('error', (error) => handleUpdateError(error))
  configured = true
}

async function runUpdateCheck(silent: boolean): Promise<UpdateStatus> {
  silentErrors = silent
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) setIdle(result?.updateInfo)
    return getUpdateStatus()
  } catch (error) {
    return handleUpdateError(error)
  } finally {
    silentErrors = false
  }
}

function setAvailable(info: UpdateInfo): UpdateStatus {
  return setStatus({ ...infoPatch(info), phase: 'available', available: true, error: undefined, progress: undefined })
}

function setDownloading(progress: ProgressInfo): UpdateStatus {
  return setStatus({ phase: 'downloading', available: true, progress: Math.round(progress.percent), error: undefined })
}

function setDownloaded(event: UpdateDownloadedEvent): UpdateStatus {
  return setStatus({ ...infoPatch(event), phase: 'downloaded', available: true, progress: 100, error: undefined })
}

function setIdle(info?: UpdateInfo): UpdateStatus {
  return setStatus({ ...infoPatch(info), phase: 'idle', available: false, error: undefined, progress: undefined })
}

function handleUpdateError(error: unknown): UpdateStatus {
  if (silentErrors) return setIdle()
  return setStatus({ phase: 'error', available: false, error: updateErrorMessage(error), progress: undefined })
}

function setStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  const next = { ...updateState.get(), currentVersion: app.getVersion(), channel: resolveUpdateChannel(), ...patch }
  updateState.set(next)
  return next
}

function idleStatus(): UpdateStatus {
  return { phase: 'idle', available: false, currentVersion: app.getVersion(), channel: resolveUpdateChannel() }
}

function infoPatch(info?: UpdateInfo): Partial<UpdateStatus> {
  if (!info) return {}
  return { latestVersion: info.version, name: info.releaseName ?? undefined, releaseUrl: releaseUrl(info.version) }
}

function checkInProgress(): boolean {
  const phase = getUpdateStatus().phase
  return phase === 'downloading' || phase === 'downloaded' || phase === 'installing'
}

function installBlockedMessage(): string | null {
  if (getRecordingState().status === RECORDING_STATUS_IDLE) return null
  return 'Update install blocked: finish the active recording before restarting Gappd.'
}

function autoUpdatesEnabled(): boolean {
  return process.platform === 'darwin' && (app.isPackaged || process.env[FORCE_DEV_UPDATE_ENV] === '1')
}

function releaseUrl(version?: string): string {
  if (!version) return DEFAULT_RELEASE_URL
  const tag = version.startsWith('v') ? version : `v${version}`
  return `https://github.com/gosvig123/gappd/releases/tag/${tag}`
}

function updateErrorMessage(error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error)
  return `Update failed: ${cause}. Retry, or download manually from the release page.`
}
