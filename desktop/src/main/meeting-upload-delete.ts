import type { CloudCredential } from './cloud-auth'
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
  const deleted = await deleteRemote(context, credential, localId, controller.signal)
  context.setPending(null)
  context.setResult(deleted
    ? `Deleted the cloud copy for ${credential.email} (${credential.subject}). The local Meeting and its audio are unchanged. This identity cannot be uploaded again, and backup removal can take up to 7 days.`
    : 'No acknowledgment. The server may have deleted the copy. Nothing was retried; confirm the account and try again.')
}

/**
 * Deletes the cloud copies of Meetings deleted on this Mac. A deletion is idempotent on the
 * server, so one without an acknowledgment stays queued and the next sync sends it again.
 */
export async function sendDeletions(context: UploadContext, credential: CloudCredential, signal: AbortSignal): Promise<void> {
  let deleted = 0
  for (const localId of await context.queue.deletionsFor(credential.subject)) {
    if (signal.aborted) return
    if (!await deleteRemote(context, credential, localId, signal)) {
      context.setResult('The cloud copy of a deleted Meeting could not be deleted yet. It stays queued and sync retries it automatically.')
      return
    }
    await context.queue.deleted(localId)
    deleted += 1
  }
  if (deleted > 0) context.setResult(`Deleted the cloud ${deleted === 1 ? 'copy' : 'copies'} of ${deleted} ${deleted === 1 ? 'Meeting' : 'Meetings'} deleted on this Mac.`)
}

function deleteRemote(context: UploadContext, credential: CloudCredential, localId: string, signal: AbortSignal): Promise<boolean> {
  const body = JSON.stringify({ meeting_id: localId })
  return context.device.signatures('DELETE', '/meeting', body)
    .then((signatures) => sendDelete(context.fetcher, context.resource, credential, localId, signatures, signal))
}
