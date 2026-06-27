import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  DEFAULT_WHISPER_MODEL_ID,
  MANAGED_WHISPER_MODELS,
  MANAGED_WHISPER_MODELS_DIRNAME,
  managedWhisperModelById,
  type ManagedWhisperModel,
} from '../shared/bundled-whisper'
import type { TranscriptionSettings, WhisperModelDownloadProgress, WhisperModelSettings } from '../shared/ipc-contract'

const TRANSCRIPTION_SETTINGS_FILE = 'transcription-settings.json'

const modelDownloads = new Map<string, Promise<TranscriptionSettings>>()

type DownloadProgressSink = (progress: WhisperModelDownloadProgress) => void
type StoredTranscriptionSettings = { defaultModelId?: string }

export async function getTranscriptionSettings(): Promise<TranscriptionSettings> {
  const defaultModelId = await readDefaultModelId()
  return { defaultModelId, models: await modelSettings() }
}

export async function downloadWhisperModel(id: string, onProgress?: DownloadProgressSink): Promise<TranscriptionSettings> {
  const model = requireModel(id)
  if (await modelInstalled(model)) return getTranscriptionSettings()
  const pending = modelDownloads.get(model.id)
  if (pending) return pending
  const task = downloadAndRefresh(model, onProgress)
  modelDownloads.set(model.id, task)
  try {
    return await task
  } finally {
    if (modelDownloads.get(model.id) === task) modelDownloads.delete(model.id)
  }
}

export async function saveDefaultWhisperModel(id: string): Promise<TranscriptionSettings> {
  const model = requireModel(id)
  if (!(await modelInstalled(model))) throw new Error(`Install ${model.label} before setting it as the default speech model.`)
  await writeSettings({ defaultModelId: model.id })
  return getTranscriptionSettings()
}

export async function resolveDefaultWhisperModelPath(): Promise<string> {
  const model = await selectedModel()
  if (!(await modelInstalled(model))) throw new Error(`Selected speech model missing. Open Settings and download ${model.label}.`)
  return modelPath(model)
}

export async function ensureSelectedWhisperModel(onProgress?: DownloadProgressSink): Promise<string> {
  const model = await selectedModel()
  await downloadWhisperModel(model.id, onProgress)
  return modelPath(model)
}

export function defaultWhisperModelPath(): string {
  return modelPath(requireModel(DEFAULT_WHISPER_MODEL_ID))
}

export async function defaultWhisperModelInstalled(): Promise<boolean> {
  return modelInstalled(requireModel(DEFAULT_WHISPER_MODEL_ID))
}

export async function selectedWhisperModelInstalled(): Promise<boolean> {
  return modelInstalled(await selectedModel())
}

async function modelSettings(): Promise<WhisperModelSettings[]> {
  return Promise.all(MANAGED_WHISPER_MODELS.map(async (model) => ({ ...model, installed: await modelInstalled(model) })))
}

async function selectedModel(): Promise<ManagedWhisperModel> {
  return requireModel(await readDefaultModelId())
}

async function readDefaultModelId(): Promise<string> {
  const stored = await readSettings()
  return managedWhisperModelById(stored.defaultModelId ?? '')?.id ?? DEFAULT_WHISPER_MODEL_ID
}

async function readSettings(): Promise<StoredTranscriptionSettings> {
  try { return JSON.parse(await readFile(settingsPath(), 'utf8')) as StoredTranscriptionSettings } catch { return {} }
}

async function writeSettings(settings: StoredTranscriptionSettings): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), TRANSCRIPTION_SETTINGS_FILE)
}

function requireModel(id: string): ManagedWhisperModel {
  const model = managedWhisperModelById(id)
  if (!model) throw new Error(`Unsupported speech model: ${id}`)
  return model
}

function modelPath(model: ManagedWhisperModel): string {
  return path.join(app.getPath('userData'), MANAGED_WHISPER_MODELS_DIRNAME, model.name)
}

async function modelInstalled(model: ManagedWhisperModel): Promise<boolean> {
  return (await fileSha256IfExists(modelPath(model))) === model.sha256
}

async function downloadAndRefresh(model: ManagedWhisperModel, onProgress?: DownloadProgressSink): Promise<TranscriptionSettings> {
  await downloadModel(model, modelPath(model), onProgress)
  return getTranscriptionSettings()
}

async function downloadModel(model: ManagedWhisperModel, targetPath: string, onProgress?: DownloadProgressSink): Promise<void> {
  emitProgress(model, 'preparing', 'Preparing download', 0, onProgress)
  await mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.download`
  await rm(tempPath, { force: true })
  try {
    await writeDownload(model, tempPath, onProgress)
    emitProgress(model, 'verifying', 'Verifying download', 99, onProgress)
    await verifyDownload(model, tempPath)
    await rename(tempPath, targetPath)
    emitProgress(model, 'complete', 'Download complete', 100, onProgress)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function writeDownload(model: ManagedWhisperModel, tempPath: string, onProgress?: DownloadProgressSink): Promise<void> {
  const response = await fetch(model.url)
  if (!response.ok) throw new Error(`Download ${model.label} failed with status ${response.status}.`)
  if (!response.body) throw new Error(`Download ${model.label} failed: response body missing.`)
  await writeResponse(model, response, tempPath, onProgress)
}

async function writeResponse(model: ManagedWhisperModel, response: Response, tempPath: string, onProgress?: DownloadProgressSink): Promise<void> {
  const input = response.body?.getReader()
  if (!input) throw new Error('Download response stream unavailable.')
  const output = await open(tempPath, 'w', 0o644)
  try {
    await writeChunks(model, input, output, response, onProgress)
  } finally {
    input.releaseLock()
    await output.close()
  }
}

async function writeChunks(model: ManagedWhisperModel, input: ReadableStreamDefaultReader<Uint8Array>, output: FileHandle, response: Response, onProgress?: DownloadProgressSink): Promise<void> {
  const total = Number.parseInt(response.headers.get('content-length') || '', 10)
  let written = 0
  for (;;) {
    const chunk = await input.read()
    if (chunk.done) return
    const buffer = Buffer.from(chunk.value)
    written += buffer.length
    await output.write(buffer)
    emitProgress(model, 'downloading', 'Downloading model', downloadProgress(total, written), onProgress)
  }
}

async function verifyDownload(model: ManagedWhisperModel, tempPath: string): Promise<void> {
  const actual = await fileSha256(tempPath)
  if (actual !== model.sha256) throw new Error(`Download ${model.label} failed sha256 check: ${actual}`)
}

function downloadProgress(total: number, written: number): number | undefined {
  if (total <= 0) return undefined
  return Math.max(0, Math.min(98, Math.round((written / total) * 98)))
}

function emitProgress(model: ManagedWhisperModel, phase: WhisperModelDownloadProgress['phase'], message: string, progress?: number, onProgress?: DownloadProgressSink): void {
  onProgress?.({ modelId: model.id, phase, message, progress })
}

async function fileSha256IfExists(filePath: string): Promise<string | null> {
  try { await access(filePath); return fileSha256(filePath) } catch { return null }
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
