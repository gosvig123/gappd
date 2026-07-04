import { execFile } from 'node:child_process'
import { isExecutableFile } from './binaries'
import { childEnv, resolveSpeechTranscriberBinary } from './native-runtime'

const SPEECH_LOCALE_ENV = 'GAPPD_SPEECH_LOCALE'
const DEFAULT_SPEECH_LOCALE = 'en_US'
const SPEECH_STATUS_NOT_INSTALLED = 2

export type AppleSpeechProgressUpdate = { message?: string; progress?: number; pullStage?: 'preparing' | 'downloading' | 'verifying' }

export async function appleSpeechAssetAvailable(): Promise<boolean> {
  const result = await runSpeechHelper(['--status', speechLocale()])
  return result.ok
}

export async function ensureAppleSpeechAsset(onProgress?: (update: AppleSpeechProgressUpdate) => void): Promise<void> {
  const bin = resolveSpeechTranscriberBinary()
  if (!(await isExecutableFile(bin))) throw new Error(missingAppleSpeechHelperMessage(bin))
  onProgress?.({ message: `Preparing Apple speech model ${speechLocale()}`, pullStage: 'preparing' })
  const result = await runSpeechHelper(['--prepare', speechLocale()])
  if (!result.ok) throw new Error(result.error)
  onProgress?.({ message: `Apple speech model ${speechLocale()} is ready`, progress: 100, pullStage: 'verifying' })
}

export function missingAppleSpeechAssetMessage(): string {
  return `Apple speech model ${speechLocale()} is not installed. Run Local AI setup to download it.`
}

export function missingAppleSpeechHelperMessage(path = resolveSpeechTranscriberBinary()): string {
  return `Apple speech transcriber missing at ${path}. Run \`npm run native:prepare -- build\`.`
}

function speechLocale(): string {
  return process.env[SPEECH_LOCALE_ENV]?.trim() || DEFAULT_SPEECH_LOCALE
}

function runSpeechHelper(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(resolveSpeechTranscriberBinary(), args, { env: childEnv() }, (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, stdout })
      if ('code' in error && error.code === SPEECH_STATUS_NOT_INSTALLED) return resolve({ ok: false, error: missingAppleSpeechAssetMessage() })
      resolve({ ok: false, error: (stderr || error.message).trim() })
    })
  })
}
