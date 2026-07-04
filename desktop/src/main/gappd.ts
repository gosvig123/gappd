import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { systemPreferences } from 'electron'
import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem } from '../shared/contracts'
import type { CapturePermissions } from '../shared/ipc-contract'
import { requestCommand } from './app-protocol'
import { ensureManagedLocalAIReady } from './local-ai-config'
import { childEnv, resolveCaptureApp, resolveCaptureBinary } from './native-runtime'

export { getLocalAIConfig, saveManagedLocalAIConfig } from './local-ai-config'
export { startRecording, stopActiveRecordingForQuit, stopRecording } from './recording-process'

const STALE_RECORDING_RECOVERY_INTERVAL_MS = 60_000

let staleRecoveryTimer: NodeJS.Timeout | null = null
let staleRecoveryRunning = false

export async function requestCapturePermissions(): Promise<CapturePermissions> {
  // The capture helper runs as a child of this app, so macOS TCC attributes the
  // helper's microphone request to the responsible process — this Electron app.
  // If the app has never been granted microphone access the helper's request
  // resolves to "denied" without ever showing a prompt. Request access here so
  // the prompt appears as "Gappd" (the app the user recognizes) and the helper
  // inherits the grant.
  const appMicStatusBefore = await ensureAppMicrophoneAccess()
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `gappd-perms-${Date.now()}.json`)
    const command = capturePermissionCommand(tmpFile)
    const details = { ...capturePermissionDetails(command), ...appMicStatusBefore }
    let stderr = ''
    const child = spawn(command.bin, command.args, { env: capturePermissionEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('close', (code) => resolvePermissionResult(tmpFile, resolve, { ...details, exitCode: String(code ?? ''), stderr: stderr.trim() }))
    child.on('error', (error) => resolve({ microphone: 'unknown', screen: 'unknown', details: { ...details, error: error.message } }))
  })
}

// Requests microphone access for this app (dev.gappd.desktop) on macOS. The app
// is the TCC-responsible process for the capture helper, so granting it here is
// what lets the helper record. Returns debug fields describing the transition.
async function ensureAppMicrophoneAccess(): Promise<Record<string, string>> {
  if (process.platform !== 'darwin') return {}
  const before = systemPreferences.getMediaAccessStatus('microphone')
  if (before !== 'not-determined') return { appMicStatusBefore: before, appMicStatusAfter: before }
  let granted = false
  try {
    granted = await systemPreferences.askForMediaAccess('microphone')
  } catch (error) {
    return { appMicStatusBefore: before, appMicStatusAfter: 'error', appMicError: String(error) }
  }
  return { appMicStatusBefore: before, appMicStatusAfter: granted ? 'granted' : 'denied' }
}

function capturePermissionCommand(tmpFile: string): { bin: string; args: string[] } {
  return { bin: resolveCaptureBinary(), args: ['--request-permissions', '--output', tmpFile] }
}

function capturePermissionEnv(): NodeJS.ProcessEnv {
  return childEnv({ GAPPD_CAPTURE_APP_PATH: resolveCaptureApp() ?? '', GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary() })
}

function capturePermissionDetails(command: { bin: string; args: string[] }): Record<string, string> {
  const appPath = resolveCaptureApp() ?? ''
  const helperPath = resolveCaptureBinary()
  return {
    launch: [command.bin, ...command.args].join(' '),
    appPath,
    helperPath,
    appExists: String(Boolean(appPath && fs.existsSync(appPath))),
    helperExists: String(fs.existsSync(helperPath)),
  }
}

export async function getDevices(): Promise<Device[]> {
  const result = await requestCommand('devices.list', {})
  return result.devices
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const result = await requestCommand('meetings.list', {})
  return result.meetings
}

export async function showMeeting(id: string): Promise<MeetingDetail> {
  const result = await requestCommand('meetings.show', { id })
  return result.meeting
}

export async function deleteMeeting(id: string): Promise<MeetingDeleteResponse> {
  return requestCommand('meetings.delete', { id })
}

export async function startStaleRecordingRecovery(): Promise<number> {
  if (!staleRecoveryTimer) staleRecoveryTimer = setInterval(() => void runStaleRecordingRecovery(), STALE_RECORDING_RECOVERY_INTERVAL_MS)
  return runStaleRecordingRecovery()
}

export function stopStaleRecordingRecovery(): void {
  if (!staleRecoveryTimer) return
  clearInterval(staleRecoveryTimer)
  staleRecoveryTimer = null
}

export async function recoverStaleRecordings(): Promise<number> {
  await ensureManagedLocalAIReady()
  const result = await requestCommand('record.recoverStale', {})
  return result.recovered
}

function resolvePermissionResult(tmpFile: string, resolve: (value: CapturePermissions) => void, details: Record<string, string>): void {
  try {
    const result = JSON.parse(fs.readFileSync(tmpFile, 'utf8'))
    resolve(permissionResult(result, details))
  } catch {
    resolve(permissionFallback(details))
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

function permissionResult(result: Record<string, string>, details: Record<string, string>): CapturePermissions {
  const microphone = result.microphone || permissionFromExit(details.exitCode)
  const screen = result.screen || permissionFromExit(details.exitCode)
  return { microphone, screen, details: cleanPermissionDetails({ ...details, ...result, microphone, screen }) }
}

function permissionFallback(details: Record<string, string>): CapturePermissions {
  const fallback = permissionFromExit(details.exitCode)
  return { microphone: fallback, screen: fallback, details }
}

function permissionFromExit(exitCode: string): string {
  return exitCode === '0' ? 'granted' : 'unknown'
}

function cleanPermissionDetails(details: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'microphone' && key !== 'screen'))
}

async function runStaleRecordingRecovery(): Promise<number> {
  if (staleRecoveryRunning) return 0
  staleRecoveryRunning = true
  try {
    return await recoverStaleRecordings()
  } catch (error) {
    console.error('stale recording recovery failed', error)
    return 0
  } finally {
    staleRecoveryRunning = false
  }
}
