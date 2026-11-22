import { app } from 'electron'
import type { StartupSettings } from '../shared/ipc-contract'
import { logFailure } from './error-log'
import { readPreferences, updatePreferences, type StoredStartupPreferences } from './preferences'

const MACOS_PLATFORM = 'darwin'
const REQUIRES_APPROVAL_STATUS = 'requires-approval'

export function initializeStartupSettings(): void {
  if (!supportsStartup()) return
  try {
    updatePreferences((current) => {
      if (current.startup?.initialized) return current
      app.setLoginItemSettings({ openAtLogin: true })
      return { ...current, startup: { ...current.startup, initialized: true } }
    })
  } catch (error) {
    logFailure('startup.open-at-login', 'Failed to enable Gappd at macOS login during first launch', error)
  }
}

export function shouldStartHidden(): boolean {
  if (!supportsStartup()) return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch (error) {
    logFailure('startup.detect-login', 'Failed to detect whether macOS opened Gappd at login', error)
    return false
  }
}

export function getStartupSettings(): StartupSettings {
  const prefs = startupPrefs()
  const speakerLabelsEnabled = prefs.speakerLabelsEnabled !== false
  const screenVideoEnabled = prefs.screenVideoEnabled === true
  const agendaAutoDraftEnabled = prefs.agendaAutoDraftEnabled === true
  const calendarRemindersEnabled = prefs.calendarRemindersEnabled !== false
  if (!supportsStartup()) return { openAtLogin: false, supported: false, requiresApproval: false, speakerLabelsEnabled, screenVideoEnabled, agendaAutoDraftEnabled, calendarRemindersEnabled }
  const settings = app.getLoginItemSettings()
  return { openAtLogin: settings.openAtLogin, supported: true, requiresApproval: settings.status === REQUIRES_APPROVAL_STATUS, speakerLabelsEnabled, screenVideoEnabled, agendaAutoDraftEnabled, calendarRemindersEnabled }
}

export function setSpeakerLabelsEnabled(enabled: boolean): StartupSettings {
  writeStartup({ speakerLabelsEnabled: enabled })
  return getStartupSettings()
}

export function setScreenVideoEnabled(enabled: boolean): StartupSettings {
  writeStartup({ screenVideoEnabled: enabled })
  return getStartupSettings()
}

/** Off by default: drafting runs the notes provider for every upcoming event with other invitees. */
export function setAgendaAutoDraftEnabled(enabled: boolean): StartupSettings {
  writeStartup({ agendaAutoDraftEnabled: enabled })
  return getStartupSettings()
}

/** On by default: the Record prompt drops down when a Calendar event with other invitees starts. */
export function setCalendarRemindersEnabled(enabled: boolean): StartupSettings {
  writeStartup({ calendarRemindersEnabled: enabled })
  return getStartupSettings()
}

export function setOpenAtLogin(openAtLogin: boolean): StartupSettings {
  if (!supportsStartup()) return getStartupSettings()
  // Save the choice first: once it is saved, no first-launch default in any process can undo it.
  // If the save fails, macOS is not changed and the error reaches the caller.
  updatePreferences((current) => ({ ...current, startup: { ...current.startup, initialized: true } }))
  app.setLoginItemSettings({ openAtLogin })
  return getStartupSettings()
}

function startupPrefs(): StoredStartupPreferences {
  return readPreferences().data.startup ?? {}
}

function writeStartup(patch: Partial<StoredStartupPreferences>): void {
  updatePreferences((current) => ({ ...current, startup: { ...current.startup, ...patch } }))
}

function supportsStartup(): boolean {
  return process.platform === MACOS_PLATFORM && app.isPackaged
}
