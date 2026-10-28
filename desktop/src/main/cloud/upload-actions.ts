import type { UploadContext } from './upload-context'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { ensureRegistered } from './upload-context.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { sendAccountAction, sendClientList } from './upload-transport.ts'

/**
 * The account-wide actions. Each one needs a registered device, and each is reported as uncertain
 * when the acknowledgment is lost, because the server may already have acted.
 */

/** Erases every cloud copy of the account and closes uploads until a new consent. */
export async function deleteAllCloudData(context: UploadContext, subject: string): Promise<void> {
  await runAccountAction(context, subject, '/delete-all', '', 'Deleting every cloud copy. Cancellation cannot recall an accepted deletion.', (value) => {
    const removed = typeof value === 'object' && value !== null && 'removed' in value ? Number((value as { removed: unknown }).removed) : 0
    return `Deleted ${removed} cloud ${removed === 1 ? 'copy' : 'copies'}. The local Meetings and their audio are unchanged. Those cloud identities cannot be uploaded again, uploads stay off until you allow them again, and backup removal can take up to 7 days.`
  })
  // Pending work can never be uploaded now: its identities are barred. Keep their deletion marks.
  await context.queue.clear()
}

/**
 * Records the user's upload consent on the server when they turn sync on. The server refuses
 * uploads from an account that never consented, so a bearer token alone cannot store Meetings.
 */
export async function consentToUploads(context: UploadContext, subject: string): Promise<void> {
  // Success needs no message: the sync switch already shows that uploads are on.
  await sendConsent(context, subject, 'Turning on uploads for this account.', () => null)
}

/** Opens uploads again and remembers the generation the server issued, which stale devices lack. */
export async function allowUploadsAgain(context: UploadContext, subject: string): Promise<void> {
  await sendConsent(context, subject, 'Allowing uploads again.', (generation) =>
    `Uploads are allowed at generation ${generation}. A Mac that still holds an older generation cannot write until someone allows uploads again on it.`)
}

async function sendConsent(context: UploadContext, subject: string, started: string, describe: (generation: string) => string | null): Promise<void> {
  await runAccountAction(context, subject, '/consent', '', started, async (value) => {
    const generation = typeof value === 'object' && value !== null && 'generation' in value ? String((value as { generation: unknown }).generation) : ''
    if (!/^[0-9]+$/.test(generation)) throw new Error('no generation')
    await context.rememberGeneration(generation)
    return describe(generation)
  })
}

/** Cuts one client's access to this account. Stored copies stay until they are deleted or expire. */
export async function revokeClientAccess(context: UploadContext, subject: string, clientId: string): Promise<void> {
  await runAccountAction(context, subject, '/revoke', JSON.stringify({ client_id: clientId }), 'Revoking that client.', () =>
    `Revoked ${clientId}. Its tokens stop working within 30 seconds. Stored cloud copies are unchanged until you delete them or they expire.`)
}

/**
 * Reads the clients that have used this account, so revocation can offer a choice. A failure is
 * an empty list rather than an error: the user can still type an id.
 */
export async function listKnownClients(context: UploadContext): Promise<string[]> {
  const credential = await context.consented()
  if (!credential) return []
  const controller = new AbortController()
  try {
    if (!await ensureRegistered(context, credential, controller.signal)) return []
    const signatures = await context.device.signatures('POST', '/clients', '')
    return await sendClientList(context.fetcher, context.resource, credential, signatures, controller.signal)
  } finally {
    controller.abort()
  }
}

/** Shared shape: authorize, register, sign, send, and report one outcome either way. */
async function runAccountAction(context: UploadContext, subject: string, path: string, body: string,
  started: string, describe: (value: unknown) => string | null | Promise<string | null>): Promise<void> {
  const credential = await context.consented()
  if (!credential || credential.subject !== subject) return
  const controller = new AbortController()
  context.setPending(controller)
  try {
    if (!await ensureRegistered(context, credential, controller.signal)) return
    context.setResult(started)
    const signatures = await context.device.signatures('POST', path, body)
    const outcome = await sendAccountAction(context.fetcher, context.resource, credential, path, body, signatures, controller.signal)
    if (!outcome.ok) {
      context.setResult(`No acknowledgment for ${path}. The server may already have acted, so check the account state before trying again.`)
      return
    }
    context.setResult(await describe(outcome.value))
  } catch {
    context.setResult(`No acknowledgment for ${path}. The server may already have acted, so check the account state before trying again.`)
  } finally {
    context.setPending(null)
  }
}
