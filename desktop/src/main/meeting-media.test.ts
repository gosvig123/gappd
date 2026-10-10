import assert from 'node:assert/strict'
import test from 'node:test'
import { constants } from 'node:fs'
import * as files from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

const UUID = '12345678-1234-1234-1234-123456789abc'
function media(assetPath = `/tmp/sessions/${UUID}/screen.mov`, files = new Set(['screen.mov', 'mic.wav', 'system.wav'])) {
  return loadSourceModule(new URL('./meeting-media.ts', import.meta.url), {
    'node:path': { default: path },
    'node:fs': { constants: {} },
    'node:stream': { Readable: {} },
    'node:fs/promises': { default: { realpath: async (file: string) => file.endsWith(UUID) || files.has(file.split('/').at(-1)!) ? file : '/elsewhere', lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }) } },
    'electron': { protocol: { handle() {} } },
    './app-protocol': { requestCommand: async () => ({ path: assetPath }) },
  })
}

test('single byte ranges are bounded; malformed and multi-range reads are rejected', () => {
  const { parseRange } = media()
  assert.equal(JSON.stringify(parseRange('bytes=0-0', 100)), '[0,0]')
  assert.equal(JSON.stringify(parseRange('bytes=98-', 100)), '[98,99]')
  assert.equal(JSON.stringify(parseRange('bytes=-3', 100)), '[97,99]')
  for (const header of ['bytes=100-', 'bytes=5-4', 'bytes=0-1,3-4', 'bytes=-0']) assert.equal(parseRange(header, 100), null)
})

test('media paths are Meeting-scoped and reject renamed movies and symlinked audio', async () => {
  assert.equal(await media().meetingMediaPath(UUID, 'mic'), `/tmp/sessions/${UUID}/mic.wav`)
  await assert.rejects(media().meetingMediaPath('../other', 'video'), /Invalid Meeting/)
  await assert.rejects(media('/tmp/sessions/other.mov').meetingMediaPath(UUID, 'video'), /Invalid managed movie/)
  await assert.rejects(media(undefined, new Set(['screen.mov'])).meetingMediaPath(UUID, 'mic'), /Invalid managed media/)
})

test('streams both Meeting voices with byte ranges from real files', async () => {
  const root = await files.realpath(await files.mkdtemp(path.join(os.tmpdir(), 'gappd-media-')))
  try {
    const dir = path.join(root, UUID)
    await files.mkdir(dir)
    for (const kind of ['screen.mov', 'mic.wav', 'system.wav']) await files.writeFile(path.join(dir, kind), Buffer.from('RIFFvoice'))
    let handle!: (request: Request) => Promise<Response>
    const module = loadSourceModule(new URL('./meeting-media.ts', import.meta.url), {
      'node:path': { default: path },
      'node:fs': { constants },
      'node:stream': { Readable },
      'node:fs/promises': { default: files },
      'electron': { protocol: { handle(_scheme: string, handler: typeof handle) { handle = handler } } },
      './app-protocol': { requestCommand: async () => ({ path: path.join(dir, 'screen.mov') }) },
    }, { Response, URL })
    module.registerMeetingMedia()
    for (const kind of ['mic', 'system']) {
      const response = await handle(new Request(`gappd-media://meeting/${UUID}/${kind}`, { headers: { Range: 'bytes=0-3' } }))
      assert.equal(response.status, 206)
      assert.equal(await response.text(), 'RIFF')
    }
  } finally { await files.rm(root, { recursive: true, force: true }) }
})
