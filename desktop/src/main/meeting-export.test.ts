import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

test('export failure keeps managed file paths out of renderer errors', async () => {
  let openedSaveDialog = false
  const module = loadSourceModule(new URL('./meeting-export.ts', import.meta.url), {
    'node:child_process': { execFile() {} },
    'node:fs/promises': { default: {} },
    'node:path': { default: path },
    'node:util': { promisify: () => () => Promise.resolve() },
    'electron': { dialog: { showSaveDialog() { openedSaveDialog = true } } },
    './binaries': { resolveBinary() {} },
    './meeting-media': { meetingMediaPath: async () => { throw new Error('ENOENT: /private/tmp/managed/system.wav') } },
    './meetings': { showMeeting: async () => ({ title: 'Test Meeting', status: { video: { state: 'ready', endSec: 10, videoStartHostSec: 1, micStartHostSec: 2, systemStartHostSec: 3 } } }) },
  }, { console: { error() {} } })
  await assert.rejects(module.exportRecording('test-meeting'), (error: Error) => {
    assert.match(error.message, /Could not export this Meeting/)
    assert.doesNotMatch(error.message, /private\/tmp|system\.wav/)
    return true
  })
  assert.equal(openedSaveDialog, false)
})
