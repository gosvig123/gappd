import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { ManagedRuntimePullStage } from '../shared/contracts'
import { MANAGED_LLAMACPP_MODEL_ARTIFACT, MANAGED_LLAMACPP_MODELS_DIRNAME } from '../shared/managed-local-ai'

type LanguageModel = typeof MANAGED_LLAMACPP_MODEL_ARTIFACT
export type LanguageModelProgress = { progress?: number; message?: string; pullStage?: ManagedRuntimePullStage }

type ProgressSink = (progress: LanguageModelProgress) => void
let downloadPromise: Promise<string> | null = null

export function managedLanguageModelPath(): string {
  return path.join(app.getPath('userData'), MANAGED_LLAMACPP_MODELS_DIRNAME, MANAGED_LLAMACPP_MODEL_ARTIFACT.name)
}

export async function managedLanguageModelAvailable(model: string = MANAGED_LLAMACPP_MODEL_ARTIFACT.id): Promise<boolean> {
  if (model !== MANAGED_LLAMACPP_MODEL_ARTIFACT.id) return false
  return (await fileSizeIfExists(managedLanguageModelPath())) === MANAGED_LLAMACPP_MODEL_ARTIFACT.size
}

export async function ensureManagedLanguageModel(onProgress?: ProgressSink): Promise<string> {
  if (await managedLanguageModelAvailable()) return managedLanguageModelPath()
  if (!downloadPromise) downloadPromise = downloadModel(MANAGED_LLAMACPP_MODEL_ARTIFACT, onProgress)
  try {
    return await downloadPromise
  } finally {
    downloadPromise = null
  }
}

export function missingManagedLanguageModelMessage(): string {
  return 'Meeting summary model missing. Click Fix setup to download it.'
}

async function downloadModel(model: LanguageModel, onProgress?: ProgressSink): Promise<string> {
  const targetPath = managedLanguageModelPath()
  emitProgress('preparing', 'Preparing meeting model download', 0, onProgress)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await downloadToTemp(model, `${targetPath}.download`, targetPath, onProgress)
  return targetPath
}

async function downloadToTemp(model: LanguageModel, tempPath: string, targetPath: string, onProgress?: ProgressSink): Promise<void> {
  await rm(tempPath, { force: true })
  try {
    await writeDownload(model, tempPath, onProgress)
    emitProgress('verifying', 'Verifying meeting model', 99, onProgress)
    await verifyDownload(model, tempPath)
    await rename(tempPath, targetPath)
    emitProgress('complete', 'Meeting model ready', 100, onProgress)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function writeDownload(model: LanguageModel, tempPath: string, onProgress?: ProgressSink): Promise<void> {
  const response = await fetch(model.url)
  if (!response.ok) throw new Error(`Download ${model.label} failed with status ${response.status}.`)
  if (!response.body) throw new Error(`Download ${model.label} failed: response body missing.`)
  await writeResponse(model, response, tempPath, onProgress)
}

async function writeResponse(model: LanguageModel, response: Response, tempPath: string, onProgress?: ProgressSink): Promise<void> {
  const input = response.body?.getReader()
  if (!input) throw new Error('Download response stream unavailable.')
  const output = await open(tempPath, 'w', 0o644)
  try { await writeChunks(model, input, output, response, onProgress) } finally { input.releaseLock(); await output.close() }
}

async function writeChunks(model: LanguageModel, input: ReadableStreamDefaultReader<Uint8Array>, output: FileHandle, response: Response, onProgress?: ProgressSink): Promise<void> {
  const total = Number.parseInt(response.headers.get('content-length') || String(model.size), 10)
  let written = 0
  for (;;) {
    const chunk = await input.read()
    if (chunk.done) return
    written += chunk.value.length
    await output.write(Buffer.from(chunk.value))
    emitProgress('downloading', 'Downloading meeting model', downloadProgress(total, written), onProgress)
  }
}

async function verifyDownload(model: LanguageModel, tempPath: string): Promise<void> {
  const actual = await fileSha256(tempPath)
  if (actual !== model.sha256) throw new Error(`Download ${model.label} failed sha256 check: ${actual}`)
}

function emitProgress(pullStage: ManagedRuntimePullStage, message: string, progress?: number, onProgress?: ProgressSink): void {
  onProgress?.({ pullStage, message, progress })
}

function downloadProgress(total: number, written: number): number | undefined {
  if (total <= 0) return undefined
  return Math.max(0, Math.min(98, Math.round((written / total) * 98)))
}

async function fileSizeIfExists(filePath: string): Promise<number | null> {
  try { return (await stat(filePath)).size } catch { return null }
}

function fileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(hash.digest('hex')))
  })
}
