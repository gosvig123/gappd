import type { CloudCredential } from './cloud-auth'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SELECTED_FIXTURE_BYTES } from '../shared/selected-fixture-contract.ts'

export async function sendSelectedFixture(fetcher: typeof fetch, resource: string, credential: CloudCredential, bytes: string, action: 'upload' | 'delete', signal: AbortSignal): Promise<string> {
  if (bytes !== SELECTED_FIXTURE_BYTES) throw new Error('Fixture egress refused.')
  try {
    const response = await fetcher(new URL('/selected-demo-meeting', resource), {
      method: action === 'upload' ? 'POST' : 'DELETE', body: action === 'upload' ? bytes : undefined,
      headers: { Authorization: `Bearer ${credential.tokens.accessToken}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    })
    const value = await boundedAcknowledgment(response)
    if (!response.ok || value.subject !== credential.subject) throw new Error('No acknowledgment.')
    if (action === 'delete' && value.status === 'deleted') return 'Cloud copy deleted. Local Meeting unchanged. This cloud identity cannot be uploaded again.'
    if (action !== 'upload' || value.status !== 'accepted' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.id) || !Number.isFinite(Date.parse(value.expires_at))) throw new Error('No acknowledgment.')
    return `Accepted cloud Meeting: ${value.id}. Expires at ${value.expires_at}. Use this ID with Pi get_meeting. OFF does not delete it.`
  } catch {
    return 'No acknowledgment. The server may have accepted the request. No automatic retry. Check the receiving account and confirm again before retrying.'
  }
}

async function boundedAcknowledgment(response: Response): Promise<Record<string, string>> {
  if (!response.body) throw new Error('No acknowledgment.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 4096) throw new Error('Acknowledgment too large.')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => undefined) }
}
