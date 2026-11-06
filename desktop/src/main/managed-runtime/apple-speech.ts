import { execFile } from 'node:child_process'
import { isExecutableFile, missingRuntimeAssetMessage } from '../binaries'
import { childEnv, resolveSpeechTranscriberBinary } from '../native-runtime'
import type { SpeechLanguageStatus } from '../../shared/ipc-contract'
import { TRANSCRIPTION_LANGUAGES } from '../../shared/transcription-languages'

const SPEECH_LOCALE_ENV = 'GAPPD_SPEECH_LOCALE'
const DEFAULT_SPEECH_LOCALE = 'en_US'
const SPEECH_STATUS_NOT_INSTALLED = 2

type AppleSpeechProgressUpdate = { message?: string; progress?: number; pullStage?: 'preparing' | 'downloading' | 'verifying' }

const languagePrepares = new Map<string, Promise<SpeechLanguageStatus>>()

export async function appleSpeechAssetAvailable(): Promise<boolean> {
  const result = await runSpeechHelper(['--status', speechLocale()])
  return result.ok
}

export async function ensureAppleSpeechAsset(onProgress?: (update: AppleSpeechProgressUpdate) => void, locale = speechLocale()): Promise<void> {
  const bin = resolveSpeechTranscriberBinary()
  if (!(await isExecutableFile(bin))) throw new Error(missingAppleSpeechHelperMessage(bin))
  onProgress?.({ message: `Preparing Apple speech model ${locale}`, pullStage: 'preparing' })
  const result = await runSpeechHelper(['--prepare', locale])
  if (!result.ok) throw new Error(result.error)
  onProgress?.({ message: `Apple speech model ${locale} is ready`, progress: 100, pullStage: 'verifying' })
}

/**
 * Downloads the Apple speech model for a Meeting language when the user picks it, so the Live Transcript
 * does not wait for it. A failed download is a status, not an error: transcription downloads it again later.
 */
export function prepareSpeechLanguage(language: string): Promise<SpeechLanguageStatus> {
  const option = TRANSCRIPTION_LANGUAGES.find((item) => item.code === language)
  if (!option) return Promise.resolve({ language, ready: false, message: `Gappd does not support the language ${language}.` })
  let pending = languagePrepares.get(language)
  if (!pending) {
    pending = ensureAppleSpeechAsset(undefined, language)
      .then((): SpeechLanguageStatus => ({ language, ready: true }))
      .catch((): SpeechLanguageStatus => ({ language, ready: false, message: `${option.label} needs a one-time speech model download. Connect to the internet; Gappd tries again when it transcribes.` }))
      .finally(() => languagePrepares.delete(language))
    languagePrepares.set(language, pending)
  }
  return pending
}

export function missingAppleSpeechAssetMessage(): string {
  return `Apple speech model ${speechLocale()} is not installed yet. Gappd downloads it when this Mac is online.`
}

function missingAppleSpeechHelperMessage(path = resolveSpeechTranscriberBinary()): string {
  return missingRuntimeAssetMessage('Apple speech transcriber', path)
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
