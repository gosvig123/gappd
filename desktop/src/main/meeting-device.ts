import { createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { SecureJsonStore } from './secure-json-store'

/**
 * A registered upload device. The server refuses every write that is not signed by one, so the
 * private key never leaves this machine and only its public half is registered.
 */
export const DEVICE_VERSION = 1
const SIGNATURE_VERSION = 'gappd-write-v1'
const SPKI_HEADER_BYTES = 12

export type DeviceCredential = {
  version: number
  privateKey: string
  publicKey: string
  deviceId: string
  /** The account generation this device was issued, once a deletion has happened. */
  generation: string
}

/** Standard base64 with no padding, which is what the server decodes. */
export function rawBase64(value: Buffer): string {
  return value.toString('base64').replace(/=+$/, '')
}

/**
 * The exact string the server verifies. It binds the device, the account generation and the body
 * digest, so a signature cannot be moved to another request, device, generation or body.
 */
export function deviceMessage(method: string, path: string, deviceId: string, generation: string, body: Buffer): string {
  const digest = createHash('sha256').update(body).digest('hex')
  return [SIGNATURE_VERSION, method, path, deviceId, generation === '' ? '0' : generation, digest].join('\n')
}

/** The raw 32-byte Ed25519 public key, taken from the SPKI wrapper Node exports. */
function rawPublicKey(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(SPKI_HEADER_BYTES)
}

export function createDeviceCredential(): DeviceCredential {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawPublicKey(publicKey)
  return {
    version: DEVICE_VERSION,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: rawBase64(raw),
    deviceId: createHash('sha256').update(raw).digest('hex'),
    generation: '',
  }
}

export function signDeviceRequest(credential: DeviceCredential, key: KeyObject, method: string, path: string, body: Buffer): Record<string, string> {
  const message = deviceMessage(method, path, credential.deviceId, credential.generation, body)
  return {
    'X-Gappd-Device': credential.deviceId,
    'X-Gappd-Signature': rawBase64(sign(null, Buffer.from(message, 'utf8'), key)),
    ...(credential.generation === '' ? {} : { 'X-Gappd-Generation': credential.generation }),
  }
}

/** Refuses a stored credential that is not a usable device, rather than signing with garbage. */
export function validatedDeviceCredential(stored: unknown): DeviceCredential | null {
  if (!stored || typeof stored !== 'object') return null
  const candidate = stored as Partial<DeviceCredential>
  if (candidate.version !== DEVICE_VERSION) return null
  if (typeof candidate.privateKey !== 'string' || !candidate.privateKey.includes('PRIVATE KEY')) return null
  if (typeof candidate.publicKey !== 'string' || candidate.publicKey.length === 0) return null
  if (typeof candidate.deviceId !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.deviceId)) return null
  if (typeof candidate.generation !== 'string' || (candidate.generation !== '' && !/^[0-9]+$/.test(candidate.generation))) return null
  return candidate as DeviceCredential
}

/**
 * Owns this machine's upload device. The credential is created once and kept in protected storage,
 * and a private key that cannot be imported is refused here rather than at the server.
 */
export class MeetingDevice {
  private readonly store: SecureJsonStore<DeviceCredential>
  private credential: DeviceCredential | null = null
  private key: KeyObject | null = null
  private registered = false

  constructor(store: SecureJsonStore<DeviceCredential>) {
    this.store = store
  }

  /** Loads the credential, creating and persisting one when none is usable. */
  async load(): Promise<DeviceCredential> {
    if (this.credential && this.key) return this.credential
    const stored = validatedDeviceCredential(await this.store.read().catch(() => null))
    const credential = stored || createDeviceCredential()
    if (!stored) await this.store.write(credential)
    this.key = createPrivateKey(credential.privateKey)
    this.credential = credential
    return credential
  }

  /** The registration body, which the server answers with the device id. */
  async registrationBody(): Promise<string> {
    const credential = await this.load()
    return JSON.stringify({ public_key: credential.publicKey })
  }

  async signatures(method: string, path: string, body: string): Promise<Record<string, string>> {
    const credential = await this.load()
    return signDeviceRequest(credential, this.key as KeyObject, method, path, Buffer.from(body, 'utf8'))
  }

  isRegistered(): boolean {
    return this.registered
  }

  markRegistered(): void {
    this.registered = true
  }

  /** Remembers a generation the server issued, so later writes can present it. */
  async rememberGeneration(generation: string): Promise<void> {
    const credential = await this.load()
    this.credential = { ...credential, generation }
    await this.store.write(this.credential)
  }
}
