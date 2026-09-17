import type { CloudCredential } from './cloud-auth'
import type { MeetingDevice } from './meeting-device'
import type { MeetingSyncQueue } from './meeting-sync-queue'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendRegistration } from './meeting-upload-transport.ts'

/**
 * What one upload action needs from the upload service, without handing the whole instance to
 * every module. The service owns consent and state; the modules own the wire calls.
 */
export type UploadContext = {
  resource: string
  device: MeetingDevice
  queue: MeetingSyncQueue
  fetcher: typeof fetch
  consented(): Promise<CloudCredential | null>
  setPending(controller: AbortController | null): void
  setResult(message: string): void
  rememberGeneration(generation: string): Promise<void>
}

/**
 * Registers this Mac's device once per credential. Every write needs the signature it makes
 * possible, so an unregistered device can never write.
 */
export async function ensureRegistered(context: UploadContext, credential: CloudCredential, signal: AbortSignal): Promise<boolean> {
  if (context.device.isRegistered()) return true
  const body = await context.device.registrationBody()
  if (!await sendRegistration(context.fetcher, context.resource, credential, body, signal)) {
    context.setResult('This Mac could not register for uploads, so nothing was sent.')
    return false
  }
  context.device.markRegistered()
  return true
}
