import { app } from 'electron'
import type { LocalAISetupPullStage } from '../shared/contracts'
import type { WhisperModelDownloadProgress } from '../shared/ipc-contract'
import { isExecutableFile, resolveBinary } from './binaries'
import { BUNDLED_WHISPER_BINARY_NAME } from '../shared/bundled-whisper'
import { defaultWhisperModelPath, ensureSelectedWhisperModel, resolveDefaultWhisperModelPath, selectedWhisperModelInstalled } from './whisper-model-settings'

const WHISPER_PULL_STAGE: Record<WhisperModelDownloadProgress['phase'], LocalAISetupPullStage> = {
  preparing: 'preparing',
  downloading: 'downloading',
  verifying: 'verifying',
  complete: 'complete',
}

export type WhisperProgressUpdate = {
  progress?: number
  message?: string
  pullStage?: LocalAISetupPullStage
  activity: boolean
}

export function resolveBundledWhisperBinary(): string {
  return resolveBinary({
    packaged: ['whisper', BUNDLED_WHISPER_BINARY_NAME],
    dev: ['resources', 'whisper', BUNDLED_WHISPER_BINARY_NAME],
  })
}

export function resolveManagedWhisperModelPath(): string {
  return defaultWhisperModelPath()
}

export async function getValidatedManagedWhisperPaths(): Promise<{ binaryPath: string; modelPath: string }> {
  const binaryPath = resolveBundledWhisperBinary()
  if (!(await bundledWhisperAvailable())) throw new Error(missingBundledWhisperMessage(binaryPath))
  const modelPath = await resolveDefaultWhisperModelPath()
  return { binaryPath, modelPath }
}

export async function bundledWhisperAvailable(): Promise<boolean> {
  return isExecutableFile(resolveBundledWhisperBinary())
}

export async function managedWhisperModelAvailable(): Promise<boolean> {
  return selectedWhisperModelInstalled()
}

export async function ensureManagedWhisperModel(onProgress?: (update: WhisperProgressUpdate) => void): Promise<string> {
  const binaryPath = resolveBundledWhisperBinary()
  if (!(await bundledWhisperAvailable())) throw new Error(missingBundledWhisperMessage(binaryPath))
  return ensureSelectedWhisperModel((progress) => onProgress?.(downloadProgress(progress)))
}

function downloadProgress(progress: WhisperModelDownloadProgress): WhisperProgressUpdate {
  return { message: progress.message, pullStage: WHISPER_PULL_STAGE[progress.phase], progress: progress.progress, activity: true }
}

export function missingBundledWhisperMessage(binaryPath = resolveBundledWhisperBinary()): string {
  return app.isPackaged
    ? 'Bundled Whisper runtime files are missing from this app. Reinstall Gappd. If the problem continues, the app bundle may be corrupted.'
    : `Bundled Whisper binary missing at ${binaryPath}. Run \`npm run prepare:whisper\` before launching the desktop app.`
}

export function missingManagedWhisperModelMessage(): string {
  return 'Speech tool missing. Click Fix setup to download it.'
}
