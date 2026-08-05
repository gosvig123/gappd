import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const APP_ID = 'dev.gappd.desktop'
const DESIGNATED_PREFIX = 'designated => '
const MARKER_FILE = 'screen-capture-code-requirement'
const SCREEN_CAPTURE = 'ScreenCapture'

export function migrateScreenCaptureIdentity(executablePath: string, appDataPath: string): boolean {
  const current = codeRequirement(executablePath)
  const markerPath = path.join(appDataPath, MARKER_FILE)
  if (!needsScreenReset(readMarker(markerPath), current)) return false
  run('tccutil', ['reset', SCREEN_CAPTURE, APP_ID])
  mkdirSync(appDataPath, { recursive: true, mode: 0o700 })
  writeFileSync(markerPath, `${current}\n`, { mode: 0o600 })
  return true
}

export function designatedRequirement(output: string): string {
  const line = output.split('\n').find((candidate) => candidate.includes(DESIGNATED_PREFIX))
  if (!line) throw new Error('codesign output did not contain a designated requirement')
  return line.slice(line.indexOf(DESIGNATED_PREFIX) + DESIGNATED_PREFIX.length).trim()
}

export function needsScreenReset(previous: string | null, current: string): boolean {
  return previous?.trim() !== current
}

function codeRequirement(executablePath: string): string {
  const result = spawnSync('codesign', ['-dr', '-', executablePath], { encoding: 'utf8' })
  if (!result.error && result.status === 0) return designatedRequirement(`${result.stderr}\n${result.stdout}`)
  throw commandError('codesign', ['-dr', '-', executablePath], result)
}

function readMarker(markerPath: string): string | null {
  try { return readFileSync(markerPath, 'utf8').trim() }
  catch { return null }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (!result.error && result.status === 0) return
  throw commandError(command, args, result)
}

function commandError(command: string, args: string[], result: ReturnType<typeof spawnSync>): Error {
  const output = result.error?.message || result.stderr?.toString().trim() || result.stdout?.toString().trim() || `Command exited with status ${result.status}`
  return new Error(`${command} ${args.join(' ')} failed.\n${output}`)
}
