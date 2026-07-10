import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { StartupSettings } from '../shared/ipc-contract'

const MACOS_PLATFORM = 'darwin'
const STARTUP_MARKER_FILE = 'startup-initialized'
const REQUIRES_APPROVAL_STATUS = 'requires-approval'

export function initializeStartupSettings(): void {
  if (!supportsStartup() || fs.existsSync(markerPath())) return
  try {
    markInitialized()
    app.setLoginItemSettings({ openAtLogin: true })
  } catch (error) {
    console.error('Failed to enable Gappd at macOS login during first launch', error)
  }
}

export function shouldStartHidden(): boolean {
  if (!supportsStartup()) return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch (error) {
    console.error('Failed to detect whether macOS opened Gappd at login', error)
    return false
  }
}

export function getStartupSettings(): StartupSettings {
  if (!supportsStartup()) return { openAtLogin: false, supported: false, requiresApproval: false }
  const settings = app.getLoginItemSettings()
  return {
    openAtLogin: settings.openAtLogin,
    supported: true,
    requiresApproval: settings.status === REQUIRES_APPROVAL_STATUS,
  }
}

export function setOpenAtLogin(openAtLogin: boolean): StartupSettings {
  if (!supportsStartup()) return getStartupSettings()
  app.setLoginItemSettings({ openAtLogin })
  return getStartupSettings()
}

function supportsStartup(): boolean {
  return process.platform === MACOS_PLATFORM && app.isPackaged
}

function markInitialized(): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(markerPath(), '', { flag: 'wx' })
}

function markerPath(): string {
  return path.join(app.getPath('userData'), STARTUP_MARKER_FILE)
}
