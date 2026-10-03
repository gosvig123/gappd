import { execFile } from 'node:child_process'

/** The cloud rejects a document above 2 MiB, so refuse one locally before reading it. */
export const MAX_DOCUMENT_BYTES = 2 << 20
const DOCUMENT_TIMEOUT_MS = 15_000
const LOCAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Builds the version-1 document for one local Meeting by running the app's own CLI. The
 * revision is passed in, because the sync queue owns it and the document carries it. Invalid
 * input never starts a process.
 */
export function meetingDocumentLoader(binary: () => string) {
  return async (localId: string, revision: number): Promise<string> => {
    if (!LOCAL_ID.test(localId) || !Number.isInteger(revision) || revision < 1) {
      throw new Error('Meeting document unavailable.')
    }
    const document = await new Promise<string>((resolve, reject) => {
      execFile(binary(), ['meeting-document', 'export', localId, String(revision)], {
        env: process.env, timeout: DOCUMENT_TIMEOUT_MS, maxBuffer: MAX_DOCUMENT_BYTES + 4096, encoding: 'utf8',
      }, (error, stdout) => error ? reject(new Error('Meeting document unavailable.')) : resolve(stdout))
    })
    if (document.length === 0 || document.length > MAX_DOCUMENT_BYTES) throw new Error('Meeting document unavailable.')
    return document
  }
}
