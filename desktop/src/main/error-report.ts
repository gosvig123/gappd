import fs from 'node:fs'
import path from 'node:path'
import { app, type Details, type RenderProcessGoneDetails, type WebContents } from 'electron'
import { describeError, isOperation, type ErrorReport, type ErrorReportStatus, type ErrorSource, type RendererError } from '../shared/error-report'
import { setFailureSink } from './error-log'
import { listMeetings } from './meetings'
import { cloudResource } from './service-config'
import { resolveUpdateChannel } from './update-channel-preference'

// Anonymous Error reports: what failed and where in Gappd's code, sent to the cloud service, which
// forwards them to the team's error channel and stores nothing. They are on unless the user turns
// them off. A failed send is dropped, never retried and never logged as a failure, so reporting
// cannot loop.
const STATE_FILE = 'error-report.json'
const URL_ENV = 'GAPPD_ERROR_REPORT_URL'
const SEND_TIMEOUT_MS = 10_000
// The same failure is sent at most once in this window; later ones are counted into the next send.
const REPEAT_WINDOW_MS = 10 * 60_000
const MAX_SENDS_PER_HOUR = 30
// The server accepts at most this many repeats.
const MAX_REPEATS = 100_000
const MEETING_CHECK_MS = 15 * 60_000
// The first Meeting check waits, so it does not compete with the app's launch.
const FIRST_MEETING_CHECK_MS = 2 * 60_000
const MAX_REPEAT_KEYS = 200

// failedMeetings holds "<Meeting id> <step>" keys; it stays on this Mac.
type StoredErrors = { version: 1; sharing: 'on' | 'off'; failedMeetings?: string[] }
type Repeat = { sentAt: number; repeats: number }

const repeats = new Map<string, Repeat>()
let sendTimes: number[] = []
let meetingTimer: NodeJS.Timeout | null = null
let firstMeetingCheck: NodeJS.Timeout | null = null
let checkingMeetings = false
// One send at a time: on a slow network a send holds a DNS lookup and a connection until its
// timeout, and a burst of failures must not hold more than one.
let sending = false
// The state file is read once; this process is its only writer.
let stored: StoredErrors | null = null

/** Report main-process failures, crashed processes and failed Meetings from now on. */
export function startErrorReports(): void {
  setFailureSink((operation, error) => reportError('main', operation, error))
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    reportError('main', origin === 'unhandledRejection' ? 'process.unhandled-rejection' : 'process.uncaught-exception', error)
  })
  app.on('render-process-gone', (_event, _contents: WebContents, details: RenderProcessGoneDetails) => {
    if (details.reason === 'clean-exit') return
    reportError('process', 'process.renderer-gone', { name: 'ProcessGone', code: details.reason })
  })
  app.on('child-process-gone', (_event, details: Details) => {
    if (details.reason === 'clean-exit') return
    reportError('process', `process.${details.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-gone`, { name: 'ProcessGone', code: details.reason })
  })
  if (!meetingTimer) meetingTimer = setInterval(() => void checkFailedMeetings(), MEETING_CHECK_MS)
  if (!firstMeetingCheck) firstMeetingCheck = setTimeout(() => void checkFailedMeetings(), FIRST_MEETING_CHECK_MS)
}

export function stopErrorReports(): void {
  setFailureSink(null)
  if (meetingTimer) clearInterval(meetingTimer)
  if (firstMeetingCheck) clearTimeout(firstMeetingCheck)
  meetingTimer = firstMeetingCheck = null
}

export function errorReportStatus(): ErrorReportStatus {
  return { sharing: readStored().sharing, available: Boolean(reportUrl()) }
}

export function setErrorSharing(enabled: boolean): ErrorReportStatus {
  // Turning reports off forgets the failed Meetings, so turning them on again takes a new baseline
  // and never sends failures from while reports were off.
  const next: StoredErrors = { ...readStored(), sharing: enabled ? 'on' : 'off' }
  if (!enabled) delete next.failedMeetings
  writeStored(next)
  return errorReportStatus()
}

/** The window's own uncaught errors. Only the fixed operations are accepted. */
export function reportRendererError(input: RendererError): void {
  if (input?.operation !== 'renderer.error' && input?.operation !== 'renderer.unhandled-rejection') return
  // The window already removed the message lines; the header line stands in for them.
  reportError('renderer', input.operation, { name: input.name, code: input.code, stack: `${input.name}\n${String(input.stack)}` })
}

/**
 * Report Meetings whose capture, processing or Screen video failed since the last check. The app
 * keeps the keys of failed Meetings it has seen; Meeting times have only whole seconds, and a
 * Screen video has no time of its own, so a time mark would miss some failures.
 */
export async function checkFailedMeetings(): Promise<void> {
  // Off or unavailable: no backend call at all. One check at a time, so a slow backend never
  // gets a second request from here.
  if (!reportUrl() || readStored().sharing !== 'on' || checkingMeetings) return
  checkingMeetings = true
  try {
    await recordFailedMeetings()
  } catch {
    // The backend is not ready, or the disk is full or locked: the next check tries again.
    // Reporting this could loop.
  } finally {
    checkingMeetings = false
  }
}

async function recordFailedMeetings(): Promise<void> {
  const meetings = await listMeetings()
  const failed = meetings.flatMap((meeting) => {
    const { capture, processing, video } = meeting.status
    return [
      capture.state === 'failed' ? `${meeting.id} capture` : '',
      processing.state === 'failed' ? `${meeting.id} processing` : '',
      video.state === 'failed' ? `${meeting.id} screen-video` : '',
    ].filter(Boolean)
  })
  const seen = readStored().failedMeetings
  // The first check only remembers, so failures from before error reports are not sent.
  if (seen) {
    for (const key of failed) {
      if (!seen.includes(key)) reportError('meeting', `meeting.${key.split(' ')[1]}`, { name: 'MeetingFailed' })
    }
  }
  writeStored({ ...readStored(), failedMeetings: failed })
}

/**
 * Send one report, or count it as a repeat. It runs inside failure paths, so it never throws and
 * never waits: the checks that drop a report come first, and the send is not awaited, has a
 * timeout and is never retried. While a send is open, a new report is dropped.
 */
function reportError(source: ErrorSource, operation: string, error: unknown): void {
  try {
    const url = reportUrl()
    if (!url || !isOperation(operation) || readStored().sharing !== 'on') return
    const described = describeError(error, [app.getAppPath()])
    const key = [source, operation, described.error_name, described.error_code].join(' ')
    const now = Date.now()
    const previous = repeats.get(key)
    if (previous && now - previous.sentAt < REPEAT_WINDOW_MS) {
      previous.repeats = Math.min(previous.repeats + 1, MAX_REPEATS)
      return
    }
    sendTimes = sendTimes.filter((time) => now - time < 60 * 60_000)
    if (sending || sendTimes.length >= MAX_SENDS_PER_HOUR) return
    sendTimes.push(now)
    if (repeats.size >= MAX_REPEAT_KEYS) repeats.clear()
    repeats.set(key, { sentAt: now, repeats: 0 })
    const report: ErrorReport = {
      v: 1,
      app_version: app.getVersion(),
      channel: resolveUpdateChannel(),
      macos_major: Number.parseInt(process.getSystemVersion(), 10),
      source,
      operation,
      ...described,
      repeats: previous?.repeats ?? 0,
    }
    const request = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS) })
    sending = true
    void request
      .then((response) => response.body?.cancel())
      .catch(() => undefined)
      .finally(() => { sending = false })
  } catch {
    // A report must never turn into a second failure.
  }
}

/** A development run sends only to an address set for it, never to the production service. */
function reportUrl(): string | null {
  const override = process.env[URL_ENV]?.trim()
  if (override) return override
  return app.isPackaged ? new URL('/errors', cloudResource()).toString() : null
}

/** A missing file means the default, on. A damaged one means off, because it may hold a choice to turn reports off. */
function readStored(): StoredErrors {
  stored ??= readStoredFile()
  return stored
}

function readStoredFile(): StoredErrors {
  let text: string
  try {
    text = fs.readFileSync(statePath(), 'utf8')
  } catch (error) {
    return { version: 1, sharing: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'on' : 'off' }
  }
  try {
    const stored = JSON.parse(text) as StoredErrors
    if (stored.version === 1 && (stored.sharing === 'on' || stored.sharing === 'off')) return stored
  } catch {
    // Damaged: fall through to off.
  }
  return { version: 1, sharing: 'off' }
}

function writeStored(next: StoredErrors): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(next), { mode: 0o600 })
  stored = next
}

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
}
