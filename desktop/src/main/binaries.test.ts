import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

const DESKTOP_ROOT = '/repo/desktop'
const RESOURCES = '/Applications/Gappd.app/Contents/Resources'
const DIARIZER = { envVar: 'GAPPD_DIARIZER_BIN', packaged: ['bin', 'gappd-diarizer'], dev: ['..', 'build', 'gappd-diarizer'] }

function binaries(isPackaged: boolean, env: Record<string, string> = {}) {
  return loadSourceModule(new URL('./binaries.ts', import.meta.url), {
    'node:path': { default: path },
    'node:fs/promises': fs,
    electron: { app: { isPackaged } },
  }, { __dirname: `${DESKTOP_ROOT}/dist-electron/main`, process: { env, resourcesPath: RESOURCES } })
}

test('packaged builds resolve bundled resources and ignore development overrides', () => {
  const resolver = binaries(true, { GAPPD_DIARIZER_BIN: '/repo/build/gappd-diarizer' })
  assert.equal(resolver.resolveBinary(DIARIZER), `${RESOURCES}/bin/gappd-diarizer`)
  assert.equal(resolver.devOverride('GAPPD_DIARIZER_BIN'), undefined)
})

test('development builds resolve worktree paths and honour overrides', () => {
  assert.equal(binaries(false).resolveBinary(DIARIZER), '/repo/build/gappd-diarizer')
  assert.equal(binaries(false, { GAPPD_DIARIZER_BIN: '/tmp/diarizer' }).resolveBinary(DIARIZER), '/tmp/diarizer')
})

test('missing asset copy gives packaged and development recovery steps', () => {
  const packaged = binaries(true).missingRuntimeAssetMessage('Speaker labeling helper or model', `${RESOURCES}/bin/gappd-diarizer`)
  assert.equal(packaged, 'Speaker labeling helper or model is missing or invalid in this copy of Gappd. Reinstall Gappd.')
  const dev = binaries(false).missingRuntimeAssetMessage('Gappd backend', '/repo/build/gappd')
  assert.equal(dev, 'Gappd backend is missing or invalid at /repo/build/gappd. Run `npm run dev:prepare` in desktop/.')
})
