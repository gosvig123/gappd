import { shell } from 'electron'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import { reminderDueEvents, reminderKey } from '../shared/calendar-reminder'
import { canStartRecordingStatus, RECORDING_STATUS_ERROR } from '../shared/meeting-recording-workflow'
import { isExpectedError, logFailure } from './error-log'
import { googleCalendarSnapshot } from './google/calendar-service'
import { dismissMeetingPrompt, showMeetingPrompt } from './meeting-notification'
import { startMeetingRecordingWorkflow } from './meeting-recording-workflow'
import { getStartupSettings } from './startup-settings'
import { getRecordingState, onRecordingStateChange, setRecordingState } from './state'

const TICK_MS = 20_000

const reminded = new Set<string>()
let shown: { key: string; end: number } | null = null
let timer: NodeJS.Timeout | null = null
let unsubscribe: (() => void) | null = null
let showApp = () => {}

/** Drops down the Meeting prompt when a Calendar event starts, so the user remembers to record it. */
export function startCalendarReminders(showMainWindow: () => void): void {
  if (timer) return
  showApp = showMainWindow
  timer = setInterval(() => void check().catch((error) => logFailure('calendar.reminder', 'Calendar reminder check failed; it will retry on the next check', error)), TICK_MS)
  unsubscribe = onRecordingStateChange((state) => { if (!canStartRecordingStatus(state.status)) dismissShown() })
}

export function stopCalendarReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
  unsubscribe?.()
  unsubscribe = null
  dismissShown()
}

async function check(): Promise<void> {
  if (shown && (Date.now() >= shown.end || !getStartupSettings().calendarRemindersEnabled)) dismissShown()
  if (!getStartupSettings().calendarRemindersEnabled || !canStartRecordingStatus(getRecordingState().status)) return
  const event = reminderDueEvents((await googleCalendarSnapshot()).events).find((item) => !reminded.has(reminderKey(item)))
  if (!event || !timer || !canStartRecordingStatus(getRecordingState().status)) return
  const key = reminderKey(event)
  reminded.add(key)
  shown = { key, end: Date.parse(event.end) }
  showMeetingPrompt({ key, heading: event.title || 'Calendar event', title: startsLabel(event), onRecord: () => void record(event), onJoin: event.joinUrl ? () => void join(event) : undefined })
}

function startsLabel(event: CalendarEventSummary): string {
  const start = Date.parse(event.start)
  const time = new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return start > Date.now() ? `Starts at ${time}` : `Started at ${time}`
}

function dismissShown(): void {
  if (shown) dismissMeetingPrompt(shown.key)
  shown = null
}

async function join(event: CalendarEventSummary): Promise<void> {
  if (event.joinUrl) await shell.openExternal(event.joinUrl).catch((error) => logFailure('calendar.reminder-join', `Open the call link of "${event.title}" failed; open it from your calendar`, error))
  await record(event)
}

async function record(event: CalendarEventSummary): Promise<void> {
  shown = null
  if (!canStartRecordingStatus(getRecordingState().status)) return
  try {
    await startMeetingRecordingWorkflow({ eventSourceId: event.sourceId, fallbackTitle: event.title })
  } catch (error) {
    if (canStartRecordingStatus(getRecordingState().status)) {
      setRecordingState({ status: RECORDING_STATUS_ERROR, title: event.title, error: error instanceof Error ? error.message : String(error) })
    }
    showApp()
    if (isExpectedError(error)) console.warn(`Record "${event.title}" from its Calendar reminder did not start:`, error)
    else logFailure('recording.calendar-reminder', `Record "${event.title}" from its Calendar reminder failed:`, error)
  }
}
