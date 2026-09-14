import type { CloudCredential } from './cloud-auth'
import type { MeetingDevice } from './meeting-device'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendDelete } from './meeting-upload-transport.ts'

/** What one deletion needs from the upload service, without handing over the whole instance. */
export type DeleteContext = {
  resource: string
  device: MeetingDevice
  fetcher: typeof fetch
  consented(): Promise<CloudCredential | null>
  ensureRegistered(credential: CloudCredential, signal: AbortSignal): Promise<boolean>
  setPending(controller: AbortController | null): void
  setResult(message: string): void
}

/**
 * Deletes one cloud copy through its own one-use confirmation. Nothing is retried: a lost
 * acknowledgment is reported as uncertain rather than repeated.
 */
export async function deleteCloudCopy(context: DeleteContext, subject: string, localId: string): Promise<void> {
  const credential = await context.consented()
  if (!credential || credential.subject !== subject) return
  const controller = new AbortController()
  context.setPending(controller)
  if (!await context.ensureRegistered(credential, controller.signal)) {
    context.setResult('This Mac is not registered for uploads, so nothing was deleted.')
    context.setPending(null)
    return
  }
  context.setResult('Deleting the cloud copy. Cancellation cannot recall an accepted request.')
  const body = JSON.stringify({ meeting_id: localId })
  const signatures = await context.device.signatures('DELETE', '/meeting', body)
  const deleted = await sendDelete(context.fetcher, context.resource, credential, localId, signatures, controller.signal)
  context.setPending(null)
  context.setResult(deleted
    ? `Deleted the cloud copy for ${credential.email} (${credential.subject}). The local Meeting and its audio are unchanged. This identity cannot be uploaded again, and backup removal can take up to 7 days.`
    : 'No acknowledgment. The server may have deleted the copy. Nothing was retried; confirm the account and try again.')
}
