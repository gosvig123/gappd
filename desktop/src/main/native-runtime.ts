import path from 'node:path'
import { resolveBinary } from './binaries'

const CAPTURE_APP_ENV = 'GAPPD_CAPTURE_APP_PATH'
const CAPTURE_HELPER_ENV = 'GAPPD_CAPTURE_HELPER_PATH'
const SPEECH_HELPER_ENV = 'GAPPD_APPLE_SPEECH_BIN'
const MACOS_EXECUTABLE_MARKER = `${path.sep}Contents${path.sep}MacOS${path.sep}`

export function resolveCaptureBinary(): string {
  return resolveBinary({
    envVar: CAPTURE_HELPER_ENV,
    packaged: ['GappdCapture.app', 'Contents', 'MacOS', 'gappd-capture'],
    dev: ['..', 'build', 'GappdCapture.app', 'Contents', 'MacOS', 'gappd-capture'],
  })
}

export function resolveCaptureApp(): string | null {
  const override = process.env[CAPTURE_APP_ENV]
  if (override) return override
  const helperOverride = process.env[CAPTURE_HELPER_ENV]
  if (helperOverride) return appPathFromBinary(helperOverride)
  return resolveBinary({ packaged: ['GappdCapture.app'], dev: ['..', 'build', 'GappdCapture.app'] })
}

function appPathFromBinary(binaryPath: string): string | null {
  const markerIndex = binaryPath.indexOf(MACOS_EXECUTABLE_MARKER)
  return markerIndex === -1 ? null : binaryPath.slice(0, markerIndex)
}

export function resolveGappdBinary(): string {
  return resolveBinary({
    envVar: 'GAPPD_BINARY_PATH',
    packaged: ['bin', 'gappd'],
    dev: ['..', 'build', 'gappd'],
  })
}

export function resolveSpeechTranscriberBinary(): string {
  return resolveBinary({
    envVar: SPEECH_HELPER_ENV,
    packaged: ['GappdSpeechTranscriber.app', 'Contents', 'MacOS', 'apple-speech-transcriber'],
    dev: ['..', 'build', 'GappdSpeechTranscriber.app', 'Contents', 'MacOS', 'apple-speech-transcriber'],
  })
}

export function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pathParts = [
    process.env.PATH ?? '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  return { ...process.env, PATH: Array.from(new Set(pathParts.filter(Boolean))).join(':'), ...overrides }
}
