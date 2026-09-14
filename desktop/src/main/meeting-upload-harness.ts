import type { CloudCredential } from './cloud-auth'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingDevice } from './meeting-device.ts'
import type { DeviceCredential } from './meeting-device'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingSyncQueue } from './meeting-sync-queue.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { MeetingUpload } from './meeting-upload.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SecureJsonStore, type StoreCipher } from './secure-json-store.ts'
import type { MeetingSyncDocument } from '../shared/meeting-sync-contract'

export const cipher: StoreCipher = {
  encrypt: (value) => Buffer.from(Buffer.from(value).toString('base64url')),
  decrypt: (value) => Buffer.from(value.toString(), 'base64url').toString(),
}

// The device credential is kept in memory, so tests exercise real signing without disk.
export class DeviceStore extends SecureJsonStore<DeviceCredential> {
  override async read(): Promise<DeviceCredential | null> { return this.stored }
  override async write(value: DeviceCredential): Promise<void> { this.stored = structuredClone(value) }
  stored: DeviceCredential | null = null
}

export class FakeStore extends SecureJsonStore<MeetingSyncDocument> {
  override async read(): Promise<MeetingSyncDocument | null> { return this.stored }
  override async write(value: MeetingSyncDocument): Promise<void> { this.stored = structuredClone(value) }
  stored: MeetingSyncDocument | null = null
}

export const MEETING = '72619a1d-f713-4f46-a2b8-c74e568726b1'
export const OTHER = '11111111-1111-5111-8111-111111111111'

export const credential = (subject = 'user_a', token = `token-${subject}`): CloudCredential => ({
  version: 1, issuer: 'https://issuer.test', clientId: 'desktop', subject, email: `${subject}@example.test`,
  tokens: { accessToken: token, expiresAt: Date.now() + 3600000, tokenType: 'Bearer' },
})

export const accepted = (revision: number, subject = 'user_a') => Response.json(
  { status: 'accepted', subject, id: '11111111-1111-5111-8111-111111111111', revision, expires_at: '2026-10-13T12:00:00Z' })

export type RecordedRequest = {
  url: string
  method: string
  body: string | undefined
  authorization: string | null
  device: string | null
  signature: string | null
  generation: string | null
}

export type HarnessOptions = { available?: boolean; fetcher?: typeof fetch; saved?: CloudCredential | null; deviceStatus?: number }

export function harness(options: HarnessOptions = {}) {
  let saved: CloudCredential | null = options.saved === undefined ? credential() : options.saved
  const requests: RecordedRequest[] = []
  const registrations: string[] = []
  const auth = buildAuth(() => saved, (next) => { saved = next })
  const upload = new MeetingUpload(auth, 'https://example.test/mcp', options.available ?? true,
    new MeetingSyncQueue(new FakeStore('/tmp/unused.enc', cipher)),
    async (_localId, revision) => `{"version":1,"revision":${revision}}`,
    new MeetingDevice(new DeviceStore('/tmp/unused.enc', cipher)),
    recordingFetcher(options, requests, registrations))
  return {
    upload, auth, requests, registrations, sends: () => requests.length,
    switch: (value: CloudCredential | null) => { saved = value },
  }
}

export type Harness = ReturnType<typeof harness>

export function buildAuth(current: () => CloudCredential | null, set: (value: CloudCredential | null) => void) {
  const auth = {
    status: async () => ({ enabled: Boolean(current()), pending: false, subject: current()?.subject ?? null, email: current()?.email ?? null, error: null }),
    credential: async () => current(),
    setEnabled: async (enabled: unknown) => { set(enabled ? credential() : null); return auth.status() },
  }
  return auth
}

// Registration is recorded separately from the writes, so a write assertion stays readable.
export function recordingFetcher(options: HarnessOptions, requests: RecordedRequest[], registrations: string[]): typeof fetch {
  return async (input, init) => {
    if (String(input).endsWith('/device')) {
      registrations.push(String(init?.body))
      if (options.deviceStatus && options.deviceStatus !== 200) return new Response('no', { status: options.deviceStatus })
      return Response.json({ status: 'registered', device_id: 'x' })
    }
    const header = new Headers(init?.headers)
    requests.push({
      url: String(input), method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      authorization: header.get('Authorization'), device: header.get('X-Gappd-Device'),
      signature: header.get('X-Gappd-Signature'), generation: header.get('X-Gappd-Generation'),
    })
    return options.fetcher ? options.fetcher(input, init) : accepted(1)
  }
}
