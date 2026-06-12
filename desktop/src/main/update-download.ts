import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, shell } from 'electron'
import type { UpdateDownloadResult } from '../shared/contracts'

const DOWNLOAD_ACCEPT_HEADER = 'application/octet-stream, application/x-apple-diskimage, */*'
const DOWNLOAD_USER_AGENT = 'gappd-desktop'
const DMG_EXTENSION = '.dmg'
const TEMP_EXTENSION = '.download'

type DownloadInput = { url: string; sha256?: string; version: string }

export async function downloadUpdateArtifact(input: DownloadInput): Promise<UpdateDownloadResult> {
  let tempPath: string | null = null
  try {
    const source = artifactUrl(input.url)
    const expectedHash = parseSha256(input.sha256)
    const targetPath = await downloadTarget(source, input.version)
    tempPath = `${targetPath}${TEMP_EXTENSION}`
    await rm(tempPath, { force: true })
    await writeArtifact(source, tempPath)
    await verifyArtifact(tempPath, expectedHash)
    await rename(tempPath, targetPath)
    await openDownloadedArtifact(targetPath)
    return { filePath: targetPath, fileName: basename(targetPath) }
  } catch (error) {
    if (tempPath) await rm(tempPath, { force: true })
    throw updateDownloadError(input.url, error)
  }
}

async function writeArtifact(source: URL, tempPath: string): Promise<void> {
  if (source.protocol === 'file:') {
    const sourcePath = fileURLToPath(source)
    await assertFile(sourcePath)
    await copyFile(sourcePath, tempPath)
    return
  }
  await downloadHttpsArtifact(source, tempPath)
}

async function downloadHttpsArtifact(source: URL, tempPath: string): Promise<void> {
  const response = await fetch(source, { headers: { Accept: DOWNLOAD_ACCEPT_HEADER, 'User-Agent': DOWNLOAD_USER_AGENT } })
  if (!response.ok) throw new Error(`server returned HTTP ${response.status}`)
  if (!response.body) throw new Error('server returned empty response body')
  await writeResponseBody(response.body, tempPath)
}

async function writeResponseBody(body: ReadableStream<Uint8Array>, tempPath: string): Promise<void> {
  const output = createWriteStream(tempPath)
  const reader = body.getReader()
  try {
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      if (!output.write(result.value)) await waitForOutput(output, 'drain')
    }
    const finished = waitForOutput(output, 'finish')
    output.end()
    await finished
  } finally {
    reader.releaseLock()
    output.destroy()
  }
}

function waitForOutput(output: WriteStream, event: 'drain' | 'finish'): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      output.removeListener(event, onEvent)
      output.removeListener('error', onError)
    }
    const onEvent = () => { cleanup(); resolve() }
    const onError = (error: Error) => { cleanup(); reject(error) }
    output.once(event, onEvent)
    output.once('error', onError)
  })
}

async function downloadTarget(source: URL, version: string): Promise<string> {
  const directory = await downloadDirectory()
  await mkdir(directory, { recursive: true })
  return join(directory, safeArtifactName(source, version))
}

async function downloadDirectory(): Promise<string> {
  try {
    return app.getPath('downloads')
  } catch {
    return app.getPath('temp')
  }
}

function artifactUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'file:') throw new Error('Update download URL must use https or file.')
  if (url.protocol === 'https:' && !url.hostname) throw new Error('Update download URL must include a host.')
  if (!url.pathname.toLowerCase().endsWith(DMG_EXTENSION)) throw new Error('Update download URL must point to a DMG file.')
  return url
}

function safeArtifactName(source: URL, version: string): string {
  const name = basename(decodeURIComponent(source.pathname)).replace(/[^a-zA-Z0-9._-]/g, '-')
  if (name.toLowerCase().endsWith(DMG_EXTENSION)) return name
  return `Gappd-${version}${DMG_EXTENSION}`
}

function parseSha256(value?: string): string | null {
  if (!value) return null
  const hash = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Update sha256 must be 64 hex characters.')
  return hash
}

async function verifyArtifact(filePath: string, expectedHash: string | null): Promise<void> {
  if (!expectedHash) return
  const actualHash = await sha256File(filePath)
  if (actualHash !== expectedHash) throw new Error(`sha256 mismatch; expected ${expectedHash}, got ${actualHash}`)
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function assertFile(filePath: string): Promise<void> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('source path is not a file')
}

async function openDownloadedArtifact(filePath: string): Promise<void> {
  shell.showItemInFolder(filePath)
  const error = await shell.openPath(filePath)
  if (error) throw new Error(`downloaded file could not be opened: ${error}`)
}

function updateDownloadError(target: string, error: unknown): Error {
  const cause = error instanceof Error ? error.message : String(error)
  return new Error(`Update download failed for ${target}: ${cause}. Retry, or open the release page and download manually.`)
}
