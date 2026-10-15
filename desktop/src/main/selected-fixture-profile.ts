import path from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { app } from 'electron'

export function selectedFixtureProfile(): string | null {
  const profile = process.env.GAPPD_SELECTED_FIXTURE_PROFILE
  if (!profile) return null
  if (app.isPackaged || !path.isAbsolute(profile) || realpathSync(profile) !== profile) throw new Error('Isolated development profile required.')
  if (readFileSync(path.join(profile, 'selected-fixture'), 'utf8') !== 'gappd-selected-local-fixture-v1\n') throw new Error('Fixture setup required.')
  const database = path.join(profile, 'backend-home', '.gappd', 'db.sqlite')
  if (realpathSync(database) !== database) throw new Error('Isolated database required.')
  return profile
}

export function initializeSelectedFixtureProfile(): void {
  const profile = selectedFixtureProfile()
  if (profile) app.setPath('userData', path.join(profile, 'electron-user-data'))
}

export function selectedFixtureBackendEnv(): NodeJS.ProcessEnv {
  const profile = selectedFixtureProfile()
  return profile ? { HOME: path.join(profile, 'backend-home') } : {}
}
