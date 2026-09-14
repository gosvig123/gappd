import type { UploadContext } from './meeting-upload-context'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { ensureRegistered } from './meeting-upload-context.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendDelete } from './meeting-upload-transport.ts' 

/**
 * Deletes one cloud copy through its own one-use confirmation. Nothing is retried: a lost
 * acknowledgment is reported as uncertain rather than repeated.
 */
export async function deleteCloudCopy(context: UploadContext, subject: string, localId: string): Promise<void> {
  const credential = await context.consented()
  if (!credential || credential.subject !== subject) return
  const controller = new AbortController()
  context.setPending(controller)
  if (!await ensureRegistered(context, credential, controller.signal)) {
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
