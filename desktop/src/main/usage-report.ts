import fs from 'node:fs'
import { app } from 'electron'
import type { MeetingListItem } from '../shared/contracts'
import { isAgentId } from '../shared/agents'
import type { UsageReport, UsageReportStatus, UsageReportView } from '../shared/usage-report'
import { requestCommand } from './app-protocol'
import { meetingUpload } from './cloud/upload-service'
import { googleCalendarSnapshot } from './google/calendar-service'
import { isManagedLocal } from './managed-runtime/status'
import { listMeetings } from './meetings'
import { readPreferences, updatePreferences, type PreferencesDocument, type StoredUsageReport } from './preferences'
import { cloudResource } from './service-config'
import { getStartupSettings } from './startup-settings'
import { resolveUpdateChannel } from './update-channel-preference'
import { logFailure } from './error-log'

// One anonymous Usage report per day the app ran, sent only when the user shares usage counts.
// It is built from data already on this Mac when it is sent, so Gappd keeps no usage log. A failed
// send is dropped, not retried, so no backlog of usage history builds up.
const URL_ENV = 'GAPPD_USAGE_REPORT_URL'
const CHECK_INTERVAL_MS = 60 * 60_000
// The first check waits a random 5 to 60 minutes, so the send time says nothing about the launch.
const FIRST_CHECK_MIN_MS = 5 * 60_000
const FIRST_CHECK_SPREAD_MS = 55 * 60_000
// A run with its own report address is a probe, so it checks soon enough to watch the send.
const PROBE_FIRST_CHECK_MS = 10_000
const SEND_TIMEOUT_MS = 10_000
const ONE_DAY_MS = 86_400_000

let timer: NodeJS.Timeout | null = null
let activeSend: AbortController | null = null

export function startUsageReports(): void {
  if (timer) return
  // Note the launch day at once, so a session that ends before the first check still counts.
  try {
    noteToday()
  } catch (error) {
    logFailure('usage-report.note-day', 'Usage report could not note the launch day', error)
  }
  timer = setTimeout(function tick() {
    void reportPreviousDay().catch((error) => logFailure('usage-report.send', 'Usage report skipped for today', error))
    timer = setTimeout(tick, CHECK_INTERVAL_MS)
  }, process.env[URL_ENV]?.trim() ? PROBE_FIRST_CHECK_MS : FIRST_CHECK_MIN_MS + Math.random() * FIRST_CHECK_SPREAD_MS)
}

export function stopUsageReports(): void {
  if (timer) clearTimeout(timer)
  timer = null
  activeSend?.abort()
  activeSend = null
}

export function usageReportStatus(): UsageReportStatus {
  const stored = readStored()
  return { sharing: stored.sharing, available: Boolean(reportUrl()), lastSentAt: stored.lastSentAt }
}

export function setUsageSharing(enabled: boolean): UsageReportStatus {
  if (!enabled) {
    activeSend?.abort()
    activeSend = null
  }
  updateStored((current) => ({ ...current, sharing: enabled ? 'on' : 'off' }))
  return usageReportStatus()
}

export async function usageReportView(): Promise<UsageReportView> {
  const stored = readStored()
  if (stored.lastReport) return { report: stored.lastReport, sentAt: stored.lastSentAt }
  return { report: await buildReport(localDay(new Date()), stored.installWeek), sentAt: null }
}

/** When the local day changed, the day that ended waits for the next check. Only the newest one is kept. */
function noteToday(): StoredUsageReport {
  const current = readStored()
  const nowDay = localDay(new Date())
  if (current.day && current.day >= nowDay) return current
  return updateStored((stored) => {
    const today = localDay(new Date())
    if (stored.day && stored.day >= today) return stored
    return { ...stored, day: today, pendingDay: stored.day || stored.pendingDay || null }
  })
}

/** Report the day that ended, if there is one. */
async function reportPreviousDay(): Promise<void> {
  let claimedDay: string | null = null
  let shouldSend = false
  let installWeek = ''
  updateStored((stored) => {
    const today = localDay(new Date())
    const noted = !stored.day || today > stored.day
      ? { ...stored, day: today, pendingDay: stored.day || stored.pendingDay || null }
      : stored
    claimedDay = noted.pendingDay ?? null
    shouldSend = noted.sharing === 'on'
    installWeek = noted.installWeek
    if (!claimedDay) return noted
    // Clear it atomically under the preferences lock, so an error or a quit can never send one day twice.
    return { ...noted, pendingDay: null }
  })
  const url = reportUrl()
  if (!claimedDay || !shouldSend || !url) return
  const report = await buildReport(claimedDay, installWeek)
  const controller = new AbortController()
  activeSend = controller
  let response: Response
  try {
    // Read consent and start the send under the preferences lock, so an opt-out from any process
    // either lands first (nothing is sent) or after the send started (this process aborts it).
    let request: Promise<Response> | null = null
    try {
      updatePreferences((current) => {
        if (controller.signal.aborted || storedUsageFrom(current).sharing !== 'on') return current
        request = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]) })
        return current
      })
    } catch (error) {
      controller.abort()
      ;(request as Promise<Response> | null)?.catch(() => {})
      throw error
    }
    if (!request) return
    response = await request
  } catch (error) {
    if (controller.signal.aborted) return
    throw error
  } finally {
    if (activeSend === controller) activeSend = null
  }
  if (controller.signal.aborted || readStored().sharing !== 'on') return
  if (!response.ok) throw new Error(`Usage report was refused with HTTP ${response.status}; it is dropped, and tomorrow's report is sent as usual.`)
  updateStored((stored) => ({ ...stored, lastReport: report, lastSentAt: new Date().toISOString() }))
}

async function buildReport(day: string, installWeek: string): Promise<UsageReport> {
  const meetings = (await listMeetings()).filter((meeting) => localDay(new Date(meeting.startedAt)) === day)
  const minutes = meetings.reduce((sum, meeting) => sum + recordedMinutes(meeting), 0)
  const failed = meetings.filter((meeting) => meeting.status.capture.state === 'failed' || meeting.status.processing.state === 'failed').length
  return {
    v: 1,
    app_version: app.getVersion(),
    channel: resolveUpdateChannel(),
    macos_major: Number.parseInt(process.getSystemVersion(), 10),
    install_week: installWeek,
    meetings_recorded: meetings.length === 0 ? '0' : meetings.length === 1 ? '1' : meetings.length <= 5 ? '2-5' : '6+',
    recording_minutes: minutes < 1 ? '0' : minutes < 30 ? '1-29' : minutes < 120 ? '30-119' : '120+',
    meetings_failed: failed === 0 ? '0' : failed === 1 ? '1' : '2+',
    screen_video_used: meetings.some((meeting) => meeting.status.video.state === 'ready'),
    notes_provider: await notesProvider(),
    calendar_connected: (await googleCalendarSnapshot()).connections.length > 0,
    cloud_sync_on: await cloudSyncOn(),
    speaker_labels_on: getStartupSettings().speakerLabelsEnabled,
  }
}

function recordedMinutes(meeting: MeetingListItem): number {
  if (!meeting.endedAt) return 0
  return Math.max(0, Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt)) / 60_000
}

async function notesProvider(): Promise<UsageReport['notes_provider']> {
  const { ai } = await requestCommand('config.aiStatus', {})
  if (isAgentId(ai.provider)) return ai.provider
  return isManagedLocal(ai) ? 'local' : 'off'
}

async function cloudSyncOn(): Promise<boolean> {
  const status = await meetingUpload().status()
  return status.consent && status.account.enabled
}

/** A development run sends only to an address set for it, never to the production service. */
function reportUrl(): string | null {
  const override = process.env[URL_ENV]?.trim()
  if (override) return override
  return app.isPackaged ? new URL('/usage', cloudResource()).toString() : null
}

function storedUsageFrom(doc: PreferencesDocument): StoredUsageReport {
  const saved = doc.usageReport
  if (saved) return { ...saved, installWeek: saved.installWeek || isoWeek(firstLaunch()) }
  return { sharing: 'unset', installWeek: isoWeek(firstLaunch()), day: '', lastReport: null, lastSentAt: null }
}

function readStored(): StoredUsageReport {
  return storedUsageFrom(readPreferences().data)
}

function updateStored(mutate: (current: StoredUsageReport) => StoredUsageReport): StoredUsageReport {
  let updated: StoredUsageReport | null = null
  updatePreferences((current) => {
    updated = mutate(storedUsageFrom(current))
    return { ...current, usageReport: updated }
  })
  return updated ?? readStored()
}

/** The app data folder is made on first launch, so its creation time is when Gappd was first used. */
function firstLaunch(): Date {
  try {
    const created = fs.statSync(app.getPath('userData')).birthtime
    if (created.getTime() > 0) return created
  } catch {
    // Use today when the folder cannot be read.
  }
  return new Date()
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** ISO 8601 week, such as 2026-W43: weeks start on Monday and belong to the year of their Thursday. */
function isoWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const week = Math.ceil(((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 1)) / ONE_DAY_MS + 1) / 7)
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
