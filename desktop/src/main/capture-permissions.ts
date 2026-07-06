import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { systemPreferences } from 'electron'
import type { CapturePermissions } from '../shared/ipc-contract'
import { childEnv, resolveCaptureApp, resolveCaptureBinary } from './native-runtime'

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

async function ensureAppMicrophoneAccess(): Promise<Record<string, string>> {
  if (process.platform !== 'darwin') return {}
  const before = systemPreferences.getMediaAccessStatus('microphone')
  if (before !== 'not-determined') return { appMicStatusBefore: before, appMicStatusAfter: before }
  try {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return { appMicStatusBefore: before, appMicStatusAfter: granted ? 'granted' : 'denied' }
  } catch (error) {
    return { appMicStatusBefore: before, appMicStatusAfter: 'error', appMicError: String(error) }
  }
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
  return { launch: [command.bin, ...command.args].join(' '), appPath, helperPath, appExists: String(Boolean(appPath && fs.existsSync(appPath))), helperExists: String(fs.existsSync(helperPath)) }
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
