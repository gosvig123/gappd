import { app, type Details, type RenderProcessGoneDetails, type WebContents } from 'electron'
import { describeError, isOperation, type ErrorReport, type ErrorReportStatus, type ErrorSource, type RendererError } from '../shared/error-report'
import { setFailureSink } from './error-log'
import { listMeetings } from './meetings'
import { readPreferences, readPreferencesLocked, updatePreferences, type PreferencesReadResult, type StoredErrorReport } from './preferences'
import { cloudResource } from './service-config'
import { resolveUpdateChannel } from './update-channel-preference'

// Anonymous Error reports: what failed and where in Gappd's code, sent to the cloud service, which
// forwards them to the team's error channel and stores nothing. They are on unless the user turns
// them off. A failed send is dropped, never retried and never logged as a failure, so reporting
// cannot loop.
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
const MAX_TRACKED_FAILED_MEETINGS = 500

type Repeat = { sentAt: number; repeats: number }

const repeats = new Map<string, Repeat>()
let sendTimes: number[] = []
let meetingTimer: NodeJS.Timeout | null = null
let firstMeetingCheck: NodeJS.Timeout | null = null
let checkingMeetings = false
// One send at a time: on a slow network a send holds a DNS lookup and a connection until its
// timeout, and a burst of failures must not hold more than one.
let sending = false
let activeSend: AbortController | null = null

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
  activeSend?.abort()
  activeSend = null
}

export function errorReportStatus(): ErrorReportStatus {
  return { sharing: readStored().sharing, available: Boolean(reportUrl()) }
}

export function setErrorSharing(enabled: boolean): ErrorReportStatus {
  // Turning reports off forgets the failed Meetings, so turning them on again takes a new baseline
  // and never sends failures from while reports were off.
  if (!enabled) {
    activeSend?.abort()
    activeSend = null
  }
  const consentToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  updatePreferences((current) => {
    if (!enabled) return { ...current, errorReport: { sharing: 'off', consentToken } }
    const failedMeetings = current.errorReport?.failedMeetings
    return { ...current, errorReport: failedMeetings ? { sharing: 'on', failedMeetings, consentToken } : { sharing: 'on', consentToken } }
  })
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
  // The scan claims only against the state it started from. If sharing or the saved failure list
  // changed in any process while Meetings were listed, its list is stale: it claims nothing and
  // the next scan starts again.
  const atStart = readStored()
  const consentToken = atStart.consentToken
  const versionAtStart = atStart.baselineVersion ?? 0
  const meetings = await listMeetings()
  const failures = meetings.flatMap((meeting) => {
    const { capture, processing, video } = meeting.status
    const entries: Array<{ key: string; step: 'capture' | 'processing' | 'screen-video'; code: string }> = []
    if (capture.state === 'failed') entries.push({ key: `${meeting.id} capture`, step: 'capture', code: meetingFailureCode('capture', capture.failureMessage) })
    if (processing.state === 'failed') entries.push({ key: `${meeting.id} processing`, step: 'processing', code: meetingFailureCode('processing', processing.failureMessage) })
    if (video.state === 'failed') entries.push({ key: `${meeting.id} screen-video`, step: 'screen-video', code: meetingFailureCode('screen-video', video.message) })
    return entries
  })
  const claimed: typeof failures = []
  updatePreferences((current) => {
    if (current.errorReport?.sharing === 'off') return current
    if (current.errorReport !== undefined && current.errorReport.sharing !== 'on') return current
    if (current.errorReport?.consentToken !== consentToken) return current
    const seen = current.errorReport?.failedMeetings
    // A version, not the list itself: trimming at the cap can restore an earlier list exactly.
    if ((current.errorReport?.baselineVersion ?? 0) !== versionAtStart) return current
    claimed.length = 0
    // Without a saved list, this scan takes the baseline and reports nothing.
    if (seen) {
      for (const entry of failures) {
        if (seen.includes(entry.key) || EXPECTED_MEETING_FAILURE_CODES.has(entry.code)) continue
        claimed.push(entry)
      }
    }
    // Keys of Meetings that still fail are never dropped, or the next scan would report them as new.
    // Other keys are kept up to the cap, newest first.
    const failing = new Set(failures.map((entry) => entry.key))
    const older = (seen ?? []).filter((key) => !failing.has(key))
    const bounded = [...older.slice(Math.max(0, older.length - MAX_TRACKED_FAILED_MEETINGS)), ...failing]
    return { ...current, errorReport: { sharing: 'on', failedMeetings: bounded, baselineVersion: versionAtStart + 1, ...(consentToken ? { consentToken } : {}) } }
  })
  for (const entry of claimed) {
    reportError('meeting', `meeting.${entry.step}`, { name: 'MeetingFailed', code: entry.code }, { consentToken })
  }
}

const EXPECTED_MEETING_FAILURE_CODES = new Set(['CAPTURE_PERMISSION_MIC', 'CAPTURE_PERMISSION_SCREEN'])

const MEETING_FAILURE_CODES: Record<'capture' | 'processing' | 'screen-video', Array<[RegExp, string]>> = {
  capture: [
    [/^Recording was interrupted before audio was saved\./, 'STALE_NO_AUDIO'],
    [/^capture process failed to start: exit status 126: error: Microphone access denied\./, 'CAPTURE_PERMISSION_MIC'],
    [/^capture process failed to start: exit status 126: error: Screen & System Audio Recording access required/, 'CAPTURE_PERMISSION_SCREEN'],
    [/could not start microphone capture/i, 'CAPTURE_MIC_START'],
    [/could not start system audio capture/i, 'CAPTURE_SYSTEM_START'],
    [/could not stop audio capture cleanly/i, 'CAPTURE_STOP_FAILED'],
    [/^(?:capture process (?:failed to start|exited immediately)|start capture: )/, 'CAPTURE_LAUNCH_FAILED'],
  ],
  processing: [
    [/no audio captured/i, 'NO_AUDIO_CAPTURED'],
    [/no transcript found/i, 'NO_TRANSCRIPT'],
    [/inconsistent meeting artifacts/i, 'INCONSISTENT_ARTIFACTS'],
    [/(?:encode|decode) extraction/i, 'EXTRACTION_INVALID'],
    [/transcription failed/i, 'TRANSCRIPTION_FAILED'],
    [/enhance failed/i, 'ENHANCE_FAILED'],
  ],
  'screen-video': [
    [/screen video was interrupted/i, 'VIDEO_INTERRUPTED'],
  ],
}

function meetingFailureCode(step: 'capture' | 'processing' | 'screen-video', message?: string | null): string {
  if (!message) return ''
  for (const [pattern, code] of MEETING_FAILURE_CODES[step]) {
    if (pattern.test(message)) return code
  }
  return ''
}

/**
 * Send one report, or count it as a repeat. It runs inside failure paths, so it never throws and
 * never waits: the checks that drop a report come first, and the send is not awaited, has a
 * timeout and is never retried. While a send is open, a new report is dropped.
 */
function reportError(source: ErrorSource, operation: string, error: unknown, claim?: { consentToken: string | undefined }): void {
  try {
    const url = reportUrl()
    const atStart = readStored()
    if (!url || !isOperation(operation) || atStart.sharing !== 'on') return
    // Sent only under the consent it was claimed or first checked with, in any process.
    const expectedToken = claim ? claim.consentToken : atStart.consentToken
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
    const controller = new AbortController()
    // Read consent and start the send under the preferences lock, so an opt-out from any process
    // either lands first (nothing is sent) or after the send started (setErrorSharing aborts it).
    let request: Promise<Response> | null = null
    readPreferencesLocked((current) => {
      const stored = storedErrorFrom(current)
      if (stored.sharing !== 'on' || stored.consentToken !== expectedToken) return
      request = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]) })
    })
    if (!request) return
    activeSend = controller
    sending = true
    void (request as Promise<Response>)
      .then((response) => response.body?.cancel())
      .catch(() => undefined)
      .finally(() => {
        if (activeSend === controller) activeSend = null
        sending = false
      })
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

/** A missing file means the default, on. A damaged file or malformed errorReport value means off. */
function readStored(): StoredErrorReport {
  return storedErrorFrom(readPreferences())
}

function storedErrorFrom(result: PreferencesReadResult): StoredErrorReport {
  if (result.status === 'damaged') return { sharing: 'off' }
  const saved = result.data.errorReport
  if (saved === undefined) return { sharing: 'on' }
  if (saved && (saved.sharing === 'on' || saved.sharing === 'off')) return saved
  return { sharing: 'off' }
}
