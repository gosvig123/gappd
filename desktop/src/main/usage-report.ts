import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { MeetingListItem } from '../shared/contracts'
import { isAgentId } from '../shared/agents'
import type { UsageReport, UsageReportStatus, UsageReportView, UsageSharing } from '../shared/usage-report'
import { requestCommand } from './app-protocol'
import { meetingUpload } from './cloud/upload-service'
import { googleCalendarSnapshot } from './google/calendar-service'
import { isManagedLocal } from './managed-runtime/status'
import { listMeetings } from './meetings'
import { cloudResource } from './service-config'
import { getStartupSettings } from './startup-settings'
import { resolveUpdateChannel } from './update-channel-preference'

// One anonymous Usage report per day the app ran, sent only when the user shares usage counts.
// It is built from data already on this Mac when it is sent, so Gappd keeps no usage log. A failed
// send is dropped, not retried, so no backlog of usage history builds up.
const STATE_FILE = 'usage-report.json'
const URL_ENV = 'GAPPD_USAGE_REPORT_URL'
const CHECK_INTERVAL_MS = 60 * 60_000
// The first check waits a random 5 to 60 minutes, so the send time says nothing about the launch.
const FIRST_CHECK_MIN_MS = 5 * 60_000
const FIRST_CHECK_SPREAD_MS = 55 * 60_000
// A run with its own report address is a probe, so it checks soon enough to watch the send.
const PROBE_FIRST_CHECK_MS = 10_000
const SEND_TIMEOUT_MS = 10_000
const ONE_DAY_MS = 86_400_000

// `day` is the last local day the app ran; `pendingDay` is the ended day that the next check reports.
type StoredUsage = {
  version: 1; sharing: UsageSharing; installWeek: string; day: string; pendingDay?: string | null
  lastReport: UsageReport | null; lastSentAt: string | null
}

let timer: NodeJS.Timeout | null = null

export function startUsageReports(): void {
  if (timer) return
  // Note the launch day at once, so a session that ends before the first check still counts.
  try {
    noteToday()
  } catch (error) {
    console.error('Usage report could not note the launch day', error)
  }
  timer = setTimeout(function tick() {
    void reportPreviousDay().catch((error) => console.error('Usage report skipped for today', error))
    timer = setTimeout(tick, CHECK_INTERVAL_MS)
  }, process.env[URL_ENV]?.trim() ? PROBE_FIRST_CHECK_MS : FIRST_CHECK_MIN_MS + Math.random() * FIRST_CHECK_SPREAD_MS)
}

export function stopUsageReports(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

export function usageReportStatus(): UsageReportStatus {
  const stored = readStored()
  return { sharing: stored.sharing, available: Boolean(reportUrl()), lastSentAt: stored.lastSentAt }
}

export function setUsageSharing(enabled: boolean): UsageReportStatus {
  writeStored({ ...readStored(), sharing: enabled ? 'on' : 'off' })
  return usageReportStatus()
}

export async function usageReportView(): Promise<UsageReportView> {
  const stored = readStored()
  if (stored.lastReport) return { report: stored.lastReport, sentAt: stored.lastSentAt }
  return { report: await buildReport(localDay(new Date()), stored.installWeek), sentAt: null }
}

/** When the local day changed, the day that ended waits for the next check. Only the newest one is kept. */
function noteToday(): StoredUsage {
  const stored = readStored()
  const today = localDay(new Date())
  if (stored.day === today) return stored
  const next = { ...stored, day: today, pendingDay: stored.day || stored.pendingDay || null }
  writeStored(next)
  return next
}

/** Report the day that ended, if there is one. */
async function reportPreviousDay(): Promise<void> {
  const stored = noteToday()
  const day = stored.pendingDay
  if (!day) return
  // Clear it first, so an error or a quit can never send one day twice.
  writeStored({ ...stored, pendingDay: null })
  const url = reportUrl()
  if (stored.sharing !== 'on' || !url) return
  const report = await buildReport(day, stored.installWeek)
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Usage report was refused with HTTP ${response.status}; it is dropped, and tomorrow's report is sent as usual.`)
  writeStored({ ...readStored(), lastReport: report, lastSentAt: new Date().toISOString() })
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

function readStored(): StoredUsage {
  try {
    const stored = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as StoredUsage
    if (stored.version === 1) return stored
  } catch {
    // A missing or damaged file starts over: sharing stays off until the user answers again.
  }
  return { version: 1, sharing: 'unset', installWeek: isoWeek(firstLaunch()), day: '', lastReport: null, lastSentAt: null }
}

function writeStored(stored: StoredUsage): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(stored), { mode: 0o600 })
}

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
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
