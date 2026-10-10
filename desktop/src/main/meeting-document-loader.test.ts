import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MAX_DOCUMENT_BYTES, meetingDocumentLoader } from './meeting-document-loader.ts'

const LOCAL_ID = '72619a1d-f713-4f46-a2b8-c74e568726b1'

// The loader runs a real process, so a fake binary exercises the whole path.
async function withBinary(script: string, run: (load: ReturnType<typeof meetingDocumentLoader>) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'gappd-loader-'))
  const binary = path.join(directory, 'gappd')
  await writeFile(binary, script, 'utf8')
  await chmod(binary, 0o700)
  await run(meetingDocumentLoader(() => binary))
}

test('the loader returns the document the CLI prints for that revision', async () => {
  await withBinary('#!/bin/sh\n[ "$1" = "meeting-document" ] && [ "$2" = "export" ] && [ "$3" = "' + LOCAL_ID + '" ] && [ "$4" = "3" ] || exit 1\nprintf \'{"version":1,"revision":3}\'\n', async (load) => {
    assert.equal(await load(LOCAL_ID, 3), '{"version":1,"revision":3}')
  })
})

test('a local Meeting the CLI cannot export is refused', async () => {
  await withBinary('#!/bin/sh\nexit 1\n', async (load) => {
    await assert.rejects(load(LOCAL_ID, 1), /Meeting document unavailable/)
  })
})

test('an empty or oversize document is refused before it reaches the queue', async () => {
  await withBinary('#!/bin/sh\nexit 0\n', async (load) => {
    await assert.rejects(load(LOCAL_ID, 1), /Meeting document unavailable/)
  })
  await withBinary(`#!/bin/sh\nhead -c ${MAX_DOCUMENT_BYTES + 1} /dev/zero | tr '\\0' 'x'\n`, async (load) => {
    await assert.rejects(load(LOCAL_ID, 1), /Meeting document unavailable/)
  })
})

test('a malformed local id or revision never starts the CLI', async () => {
  await withBinary('#!/bin/sh\ntouch "$GAPPD_MARKER"\n', async (load) => {
    const marker = path.join(tmpdir(), `gappd-loader-marker-${Date.now()}`)
    process.env.GAPPD_MARKER = marker
    try {
      for (const [localId, revision] of [['not-a-uuid', 1], ['', 1], [LOCAL_ID, 0], [LOCAL_ID, -2], [LOCAL_ID, 1.5]] as const) {
        await assert.rejects(load(localId, revision as number), /Meeting document unavailable/)
      }
      const { stat } = await import('node:fs/promises')
      await assert.rejects(stat(marker), 'the CLI must not run for invalid input')
    } finally { delete process.env.GAPPD_MARKER }
  })
})
