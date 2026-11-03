/**
 * The anonymous Error report. It says what failed and where in Gappd's own code, never why in
 * words: no error message, account, device, install id, title, name or path. The cloud service
 * accepts exactly these fields (cloud/internal/service/error_report.go), and
 * docs/error-reports.md explains each one.
 */
export type ErrorReport = {
  v: 1
  app_version: string
  channel: 'stable' | 'beta'
  macos_major: number
  source: ErrorSource
  operation: string
  error_name: string
  error_code: string
  stack: string[]
  repeats: number
}

/** main: the main process; renderer: the window; process: a crashed process; meeting: a failed Meeting. */
export type ErrorSource = 'main' | 'renderer' | 'process' | 'meeting'

/** Error reports are on unless the user turned them off. */
export type ErrorReportStatus = { sharing: 'on' | 'off'; available: boolean }

/** What the window sends when it has an error that nothing caught. The main process cleans it. */
export type RendererError = { operation: 'renderer.error' | 'renderer.unhandled-rejection'; name: string; code: string; stack: string }
// stack holds only the frame lines (stackFrames), so the error message never leaves the window.

// Names and codes have the shape of a code constant, not free text: an error class name, a
// constant such as ENOENT or ERR_INVALID_ARG_TYPE, a short number, or an Electron exit reason.
const ERROR_NAME = /^(NonError|ProcessGone|MeetingFailed|([A-Z][A-Za-z0-9]{0,40})?(Error|Exception))$/
const ERROR_CODE = /^([A-Z][A-Z0-9_]{1,39}|[0-9]{1,4}|abnormal-exit|killed|crashed|oom|launch-failed|integrity-failure|memory-eviction)?$/
const OPERATION = /^[a-z][a-z0-9-]{0,30}(\.[a-z0-9-]{1,30}){0,3}$/
const FRAME_NAME = /^[A-Za-z0-9_$.<>[\] ]{1,80}$/
// Only Gappd's own bundles: the built main and preload files, the built window code, and the
// sources a development window loads. The server accepts the same files.
const APP_FILE = /^(dist-electron\/(main\/main|preload\/index)\.js|dist\/assets\/[A-Za-z0-9_-]{1,80}\.js|src\/[A-Za-z0-9_/-]{1,100}\.tsx?|node_modules\/\.vite\/deps\/[A-Za-z0-9_.-]{1,80}\.js)$/
const FRAME = /^at (?:(.+?) \()?(.+?):(\d{1,7}):(\d{1,7})\)?$/
const MAX_FRAMES = 10

/** The name, code and app-code frames of an error. Anything that does not fit is left out, not cleaned. */
export function describeError(error: unknown, appRoots: string[]): Pick<ErrorReport, 'error_name' | 'error_code' | 'stack'> {
  const fields = typeof error === 'object' && error !== null ? error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown } : {}
  const name = typeof fields.name === 'string' && ERROR_NAME.test(fields.name) ? fields.name : error instanceof Error ? 'Error' : 'NonError'
  return { error_name: name, error_code: errorCode(fields.code), stack: appFrames(stackFrames(fields.stack, fields.message), appRoots) }
}

/**
 * The frame lines of a stack, without its first lines, which repeat the error message. A message
 * can hold any text, including lines that look like frames.
 */
export function stackFrames(stack: unknown, message: unknown): string {
  if (typeof stack !== 'string') return ''
  const header = 1 + (typeof message === 'string' ? message.split('\n').length - 1 : 0)
  return stack.split('\n').slice(header).join('\n')
}

function errorCode(code: unknown): string {
  const text = typeof code === 'number' && Number.isInteger(code) ? String(code) : code
  return typeof text === 'string' && ERROR_CODE.test(text) ? text : ''
}

/**
 * Frames in Gappd's own code, as "function file:line:column" with the file relative to the app.
 * A frame in any other file (Node, Electron, a path in the user's home) is dropped.
 */
export function appFrames(frameLines: string, appRoots: string[]): string[] {
  const frames: string[] = []
  for (const raw of frameLines.split('\n')) {
    const match = FRAME.exec(raw.trim())
    if (!match) continue
    const file = appRelative(match[2], appRoots)
    if (!file || !APP_FILE.test(file)) continue
    const name = match[1] && FRAME_NAME.test(match[1]) ? `${match[1]} ` : ''
    frames.push(`${name}${file}:${match[3]}:${match[4]}`)
    if (frames.length === MAX_FRAMES) break
  }
  return frames
}

function appRelative(location: string, appRoots: string[]): string | null {
  let target = location
  try {
    const url = new URL(location)
    if (url.protocol === 'file:') target = decodeURIComponent(url.pathname)
    // A development window loads its code from the local dev server.
    else if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return url.pathname.slice(1)
    else return null
  } catch {
    // A plain path, as in main-process stacks.
  }
  for (const root of appRoots) {
    if (root && target.startsWith(`${root}/`)) return target.slice(root.length + 1)
  }
  return null
}

/** An IPC channel such as meetingUpload:sync becomes the operation ipc.meeting-upload.sync. */
export function ipcOperation(channel: string): string {
  const operation = `ipc.${channel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/:/g, '.')}`
  return isOperation(operation) ? operation : 'ipc.unknown'
}

export function isOperation(operation: string): boolean {
  return OPERATION.test(operation)
}
