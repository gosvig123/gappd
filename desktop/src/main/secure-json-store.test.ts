import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SecureJsonStore, type StoreCipher } from './secure-json-store.ts'

const cipher: StoreCipher = {
  encrypt: (value) => Buffer.from(Buffer.from(value).toString('base64url')),
  decrypt: (value) => Buffer.from(value.toString(), 'base64url').toString(),
}

test('secure store persists ciphertext with private permissions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gappd-secure-store-'))
  const file = path.join(directory, 'tokens.enc')
  try {
    const store = new SecureJsonStore<{ token: string }>(file, cipher)
    await store.write({ token: 'private-token' })
    assert.doesNotMatch((await readFile(file)).toString(), /private-token/)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.deepEqual(await store.read(), { token: 'private-token' })
    await store.clear()
    assert.equal(await store.read(), null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('secure store hides decryption and parsing failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gappd-secure-store-'))
  const file = path.join(directory, 'tokens.enc')
  try {
    await writeFile(file, 'not-valid-ciphertext')
    const store = new SecureJsonStore(file, cipher)
    await assert.rejects(store.read(), /Secure local data could not be read/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
