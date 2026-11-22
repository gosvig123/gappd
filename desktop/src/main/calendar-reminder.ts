import { shell } from 'electron'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import { reminderDueEvents, reminderEligible, reminderKey } from '../shared/calendar-reminder'
import { canStartRecordingStatus, RECORDING_STATUS_ERROR } from '../shared/meeting-recording-workflow'
import { isExpectedError, logFailure } from './error-log'
import { googleCalendarSnapshot, onGoogleCalendarChange } from './google/calendar-service'
import { dismissMeetingPrompt, meetingPromptShown, showMeetingPrompt } from './meeting-notification'
import { startMeetingRecordingWorkflow } from './meeting-recording-workflow'
import { getStartupSettings } from './startup-settings'
import { getRecordingState, onRecordingStateChange, setRecordingState } from './state'

const TICK_MS = 20_000

const reminded = new Set<string>()
/** The reminder on screen, with its event as of the last check. */
let shown: { key: string; event: CalendarEventSummary } | null = null
let timer: NodeJS.Timeout | null = null
let unsubscribe: (() => void)[] = []
let showApp = () => {}

/** Drops down the Meeting prompt when a Calendar event starts, so the user remembers to record it. */
export function startCalendarReminders(showMainWindow: () => void): void {
  if (timer) return
  showApp = showMainWindow
  timer = setInterval(() => void check().catch((error) => logFailure('calendar.reminder', 'Calendar reminder check failed; it will retry on the next check', error)), TICK_MS)
  unsubscribe = [
    onRecordingStateChange((state) => { if (!canStartRecordingStatus(state.status)) dismissCalendarReminder() }),
    // A Calendar sync or disconnect updates the shown reminder at once, not on the next check.
    onGoogleCalendarChange((snapshot) => { if (shown) refreshShown(snapshot.events) }),
  ]
}

export function stopCalendarReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  dismissCalendarReminder()
}

async function check(): Promise<void> {
  // Close an ended reminder first, so a failed Calendar read cannot keep it on screen.
  if (!enabled() || (shown && !reminderEligible(shown.event))) return dismissCalendarReminder()
  const { events } = await googleCalendarSnapshot()
  if (!timer || !enabled()) return dismissCalendarReminder()
  if (shown) refreshShown(events)
  if (!canStartRecordingStatus(getRecordingState().status)) return
  const event = reminderDueEvents(events).find((item) => !reminded.has(reminderKey(item)))
  if (!event) return
  const key = reminderKey(event)
  reminded.add(key)
  showReminder(key, event)
}

function showReminder(key: string, event: CalendarEventSummary): void {
  shown = { key, event }
  showMeetingPrompt({ key, heading: event.title || 'Calendar event', title: startsLabel(event), onRecord: () => void act(key, false), onJoin: event.joinUrl ? () => void act(key, true) : undefined })
}

/** Keeps the shown event current after a Calendar sync; closes the reminder when the event ended, moved, or was cancelled or declined. */
function refreshShown(events: CalendarEventSummary[]): void {
  const event = shown && events.find((item) => reminderKey(item) === shown?.key)
  if (!shown || !event || !reminderEligible(event)) return dismissCalendarReminder()
  const changed = event.joinUrl !== shown.event.joinUrl || event.title !== shown.event.title
  shown.event = event
  // Redraw only a reminder still on screen whose buttons or title changed; the key stays, so it is not a new reminder.
  if (changed && meetingPromptShown(shown.key)) showReminder(shown.key, event)
}

/** Closes the Calendar reminder on screen, for example when the Settings switch turns off. */
export function dismissCalendarReminder(): void {
  if (shown) dismissMeetingPrompt(shown.key)
  shown = null
}

function startsLabel(event: CalendarEventSummary): string {
  const start = Date.parse(event.start)
  const time = new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return start > Date.now() ? `Starts at ${time}` : `Started at ${time}`
}

async function act(key: string, joinCall: boolean): Promise<void> {
  const event = shown?.key === key ? shown.event : null
  if (shown?.key === key) shown = null
  if (!event || !enabled() || !reminderEligible(event)) return
  // Recording starts even when the link does not open: the user asked to record this meeting.
  if (joinCall && event.joinUrl) await shell.openExternal(event.joinUrl).catch((error) => logFailure('calendar.reminder-join', `Open the call link of "${event.title}" failed; open it from your calendar`, error))
  await record(event)
}

function enabled(): boolean {
  return getStartupSettings().calendarRemindersEnabled
}

async function record(event: CalendarEventSummary): Promise<void> {
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
