import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

function profileModule(profile?: string, packaged = false) {
  const paths: string[][] = []
  const env = { HOME: '/unchanged-electron-home', GAPPD_SELECTED_FIXTURE_PROFILE: profile }
  const module = loadSourceModule(new URL('./selected-fixture-profile.ts', import.meta.url), {
    'node:path': { default: path }, 'node:fs': { readFileSync, realpathSync },
    electron: { app: { isPackaged: packaged, setPath: (...args: string[]) => paths.push(args) } },
  }, { process: { env } })
  return { module, paths, env }
}

test('fixture profile isolates userData and backend HOME, never Electron HOME', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gappd-profile-test-')))
  try {
    mkdirSync(path.join(root, 'backend-home', '.gappd'), { recursive: true })
    writeFileSync(path.join(root, 'backend-home', '.gappd', 'db.sqlite'), '')
    writeFileSync(path.join(root, 'selected-fixture'), 'gappd-selected-local-fixture-v1\n')
    const h = profileModule(root)
    h.module.initializeSelectedFixtureProfile()
    assert.equal(h.paths[0][1], path.join(root, 'electron-user-data'))
    assert.equal(h.module.selectedFixtureBackendEnv().HOME, path.join(root, 'backend-home'))
    assert.equal(h.env.HOME, '/unchanged-electron-home')
    assert.throws(() => profileModule(root, true).module.selectedFixtureProfile())
    const link = path.join(root, 'alias'); symlinkSync(root, link)
    assert.throws(() => profileModule(link).module.selectedFixtureProfile())
  } finally { rmSync(root, { recursive: true, force: true }) }
  const off = profileModule()
  off.module.initializeSelectedFixtureProfile()
  assert.equal(off.paths.length, 0)
  assert.equal(Object.keys(off.module.selectedFixtureBackendEnv()).length, 0)
})
