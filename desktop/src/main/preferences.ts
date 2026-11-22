import { app } from 'electron'
import { PreferencesStore, type PreferencesDocument, type PreferencesReadResult } from './preferences-store'

export type { PreferencesDocument, PreferencesReadResult, StoredErrorReport, StoredRemoteAccess, StoredStartupPreferences, StoredUsageReport } from './preferences-store'

let store: PreferencesStore | null = null
let storeDir = ''

function currentStore(): PreferencesStore {
  const dir = app.getPath('userData')
  if (!store || storeDir !== dir) {
    store = new PreferencesStore(dir)
    storeDir = dir
  }
  return store
}

export function readPreferences(): PreferencesReadResult {
  return currentStore().read()
}

/** Runs `action` on the current preferences under the cross-process lock, without writing. */
export function readPreferencesLocked<T>(action: (current: PreferencesReadResult) => T): T {
  return currentStore().readLocked(action)
}

export function updatePreferences(mutate: (current: PreferencesDocument) => PreferencesDocument, options?: { strict?: boolean }): PreferencesDocument {
  return currentStore().update(mutate, options)
}
