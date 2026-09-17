import os from 'node:os'
import { shell } from 'electron'
import type { CapturePermissionTarget } from '../shared/ipc-contract'

const SYSTEM_SETTINGS_DARWIN_MAJOR = 22
const LEGACY_PRIVACY_SECURITY_PANE = 'com.apple.preference.security'
const MODERN_PRIVACY_SECURITY_PANE = 'com.apple.settings.PrivacySecurity.extension'
const PRIVACY_MAIN_ANCHOR = 'Privacy'
const PRIVACY_MICROPHONE_ANCHOR = 'Privacy_Microphone'
const PRIVACY_SCREEN_CAPTURE_ANCHOR = 'Privacy_ScreenCapture'
const PRIVACY_ANCHORS: Record<CapturePermissionTarget, string> = {
  'microphone': PRIVACY_MICROPHONE_ANCHOR,
  'screen-recording': PRIVACY_SCREEN_CAPTURE_ANCHOR,
}

function privacySettingsUrl(target?: CapturePermissionTarget): string {
  const anchor = target ? PRIVACY_ANCHORS[target] : legacyPrivacyAnchor()
  const suffix = anchor ? `?${anchor}` : ''
  return `x-apple.systempreferences:${privacySecurityPane()}${suffix}`
}

function privacySecurityPane(): string {
  return usesModernPrivacyPane() ? MODERN_PRIVACY_SECURITY_PANE : LEGACY_PRIVACY_SECURITY_PANE
}

function legacyPrivacyAnchor(): string {
  return usesModernPrivacyPane() ? '' : PRIVACY_MAIN_ANCHOR
}

function usesModernPrivacyPane(): boolean {
  if (process.platform !== 'darwin') return true
  const darwinMajor = Number.parseInt(os.release().split('.')[0] ?? '', 10)
  return Number.isNaN(darwinMajor) || darwinMajor >= SYSTEM_SETTINGS_DARWIN_MAJOR
}

export async function openPermissionsSettings(target?: CapturePermissionTarget): Promise<void> {
  await shell.openExternal(privacySettingsUrl(target), { activate: true })
}
