import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingDevice, createDeviceCredential, deviceMessage, rawBase64, signDeviceRequest, validatedDeviceCredential } from './meeting-device.ts'
import type { DeviceCredential } from './meeting-device'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SecureJsonStore, type StoreCipher } from './secure-json-store.ts'

const cipher: StoreCipher = {
  encrypt: (value) => Buffer.from(Buffer.from(value).toString('base64url')),
  decrypt: (value) => Buffer.from(value.toString(), 'base64url').toString(),
}

class DeviceStore extends SecureJsonStore<DeviceCredential> {
  override async read(): Promise<DeviceCredential | null> { return this.stored }
  override async write(value: DeviceCredential): Promise<void> { this.stored = structuredClone(value) }
  stored: DeviceCredential | null = null
}

test('the device id is the sha256 of the raw public key', () => {
  const credential = createDeviceCredential()
  const raw = Buffer.from(credential.publicKey, 'base64')
  assert.equal(raw.length, 32, 'a raw Ed25519 key is 32 bytes')
  assert.equal(credential.deviceId, createHash('sha256').update(raw).digest('hex'))
  assert.equal(credential.publicKey.includes('='), false, 'the server decodes unpadded base64')
})

test('the signed message matches the server format exactly', () => {
  const body = Buffer.from('{"version":1}', 'utf8')
  const message = deviceMessage('POST', '/meeting', 'a'.repeat(64), '7', body)
  // The cloud pins the same literal in cloud/internal/service/device_message_test.go.
  const digest = createHash('sha256').update(body).digest('hex')
  assert.equal(message, ['gappd-write-v1', 'POST', '/meeting', 'a'.repeat(64), '7', digest].join('\n'))
  // An account with no generation signs zero, which is what an absent header means.
  assert.equal(deviceMessage('DELETE', '/meeting', 'b'.repeat(64), '', body).split('\n')[4], '0')
})

test('a signature verifies over the same message and only that message', () => {
  const credential = createDeviceCredential()
  const publicKey = createPublicKey(credential.privateKey)
  const body = Buffer.from('{"version":1}', 'utf8')
  const headers = signDeviceRequest(credential, createPrivateKey(credential.privateKey), 'POST', '/meeting', body)
  assert.equal(headers['X-Gappd-Device'], credential.deviceId)
  assert.equal(headers['X-Gappd-Generation'], undefined)
  const message = deviceMessage('POST', '/meeting', credential.deviceId, '', body)
  assert.equal(verify(null, Buffer.from(message), publicKey, Buffer.from(headers['X-Gappd-Signature'], 'base64')), true)
  // Another body, path or device must not verify with the same signature.
  for (const other of [
    deviceMessage('POST', '/meeting', credential.deviceId, '', Buffer.from('{"version":2}', 'utf8')),
    deviceMessage('POST', '/revoke', credential.deviceId, '', body),
    deviceMessage('POST', '/meeting', 'c'.repeat(64), '', body),
    deviceMessage('POST', '/meeting', credential.deviceId, '1', body),
  ]) {
    assert.equal(verify(null, Buffer.from(other), publicKey, Buffer.from(headers['X-Gappd-Signature'], 'base64')), false)
  }
})

test('a generation is signed and sent once the server issued one', () => {
  const credential = { ...createDeviceCredential(), generation: '4' }
  const headers = signDeviceRequest(credential, createPrivateKey(credential.privateKey), 'POST', '/meeting', Buffer.from('x'))
  assert.equal(headers['X-Gappd-Generation'], '4')
  const message = deviceMessage('POST', '/meeting', credential.deviceId, '4', Buffer.from('x'))
  const publicKey = createPublicKey(credential.privateKey)
  assert.equal(verify(null, Buffer.from(message), publicKey, Buffer.from(headers['X-Gappd-Signature'], 'base64')), true)
})

test('the device credential is created once and reused', async () => {
  const store = new DeviceStore('/tmp/unused.enc', cipher)
  const first = await new MeetingDevice(store).load()
  const second = await new MeetingDevice(store).load()
  assert.equal(second.deviceId, first.deviceId)
  assert.equal(store.stored?.deviceId, first.deviceId)
})

test('a damaged stored credential is replaced rather than used', async () => {
  const store = new DeviceStore('/tmp/unused.enc', cipher)
  store.stored = { version: 1, privateKey: 'not a key', publicKey: 'x', deviceId: 'nope', generation: '' }
  const restored = await new MeetingDevice(store).load()
  assert.match(restored.deviceId, /^[0-9a-f]{64}$/)
  assert.equal(store.stored?.deviceId, restored.deviceId, 'the replacement was persisted')
})

test('registration is remembered so it happens once', async () => {
  const device = new MeetingDevice(new DeviceStore('/tmp/unused.enc', cipher))
  assert.equal(device.isRegistered(), false)
  assert.match(await device.registrationBody(), /"public_key":"[A-Za-z0-9+/]+"/)
  device.markRegistered()
  assert.equal(device.isRegistered(), true)
})

test('the validator refuses every unusable shape', () => {
  const good = createDeviceCredential()
  assert.ok(validatedDeviceCredential(good))
  for (const bad of [
    null, {}, { ...good, version: 2 }, { ...good, privateKey: 'x' }, { ...good, publicKey: '' },
    { ...good, deviceId: 'short' }, { ...good, deviceId: 'z'.repeat(64) }, { ...good, generation: 'x' },
  ]) {
    assert.equal(validatedDeviceCredential(bad), null)
  }
  assert.ok(validatedDeviceCredential({ ...good, generation: '12' }))
})

test('rawBase64 strips padding and keeps the standard alphabet', () => {
  assert.equal(rawBase64(Buffer.from([0xff, 0xfe, 0xfd])), '//79')
  assert.equal(rawBase64(Buffer.alloc(32)).length, 43)
})

