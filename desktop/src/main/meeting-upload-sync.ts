import type { CloudCredential } from './cloud-auth'
import type { MeetingSyncWork } from '../shared/meeting-sync-contract'
import type { UploadContext } from './meeting-upload-context'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { ensureRegistered } from './meeting-upload-context.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { acceptedMessage } from './meeting-upload-ack.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendDocument } from './meeting-upload-transport.ts'

/** One sync call sends at most this many Meetings, so a call cannot loop without end. */
const MAX_SENDS_PER_SYNC = 5

/** Sends queued copies while consent and the account still hold, and stops the moment they do not. */
export async function syncUploads(context: UploadContext): Promise<void> {
  const credential = await context.consented()
  if (!credential) return
  const controller = new AbortController()
  context.setPending(controller)
  try {
    if (!await ensureRegistered(context, credential, controller.signal)) return
    for (let sent = 0; sent < MAX_SENDS_PER_SYNC; sent++) {
      if (controller.signal.aborted) return
      const work = await context.queue.pending()
      if (!work) return
      if (!await sendOne(context, credential, controller, work)) return
    }
  } finally {
    context.setPending(null)
  }
}

async function sendOne(context: UploadContext, credential: CloudCredential, controller: AbortController, work: MeetingSyncWork): Promise<boolean> {
  const signatures = await context.device.signatures('POST', '/meeting', work.document)
  const outcome = await sendDocument(context.fetcher, context.resource, credential, signatures, work, controller.signal)
  if (controller.signal.aborted) return false
  if (outcome.kind === 'accepted') {
    await context.queue.succeed(work.localId, work.revision)
    context.setResult(acceptedMessage(credential, work, outcome.expiresAt))
    return true
  }
  if (outcome.kind === 'refused') {
    await context.queue.reject(work.localId, work.revision, 'The server refused this Meeting document. Recording it again will not help.')
    context.setResult('The server refused one Meeting document. Other queued Meetings are unaffected.')
    return true
  }
  await context.queue.fail(work.localId, work.revision, 'No acknowledgment from Gappd Cloud.')
  context.setResult('No acknowledgment. The server may have accepted the copy; it will be retried. A cloud copy is never deleted by turning sync off.')
  return false
}
