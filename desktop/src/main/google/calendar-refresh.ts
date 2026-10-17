import { app, powerMonitor } from 'electron'
import { backgroundSyncGoogleCalendar } from './calendar-service'

// Google Calendar has no push channel to this Mac, so connected accounts are synced on a timer,
// when a Gappd window gets focus, and after the Mac wakes.
const STARTUP_DELAY_MS = 10_000
const TICK_MS = 5 * 60_000
const BATTERY_INTERVAL_MS = 15 * 60_000
const EVENT_MIN_GAP_MS = 60_000
// Network is often not back yet when the Mac reports that it woke.
const WAKE_DELAY_MS = 30_000

let timer: NodeJS.Timeout | null = null
let wakeTimer: NodeJS.Timeout | null = null
let running = false
let lastStartedAt = 0

export function startCalendarRefresh(): void {
  if (timer) return
  timer = setInterval(onTick, TICK_MS)
  setTimeout(() => refreshIfDue(0), STARTUP_DELAY_MS)
  app.on('browser-window-focus', onFocus)
  powerMonitor.on('resume', onWake)
}

export function stopCalendarRefresh(): void {
  if (timer) clearInterval(timer)
  if (wakeTimer) clearTimeout(wakeTimer)
  timer = null
  wakeTimer = null
  app.off('browser-window-focus', onFocus)
  powerMonitor.off('resume', onWake)
}

function onTick(): void {
  // A few seconds of slack keeps a 5-minute tick from missing a 5-minute gap.
  refreshIfDue((powerMonitor.isOnBatteryPower() ? BATTERY_INTERVAL_MS : TICK_MS) - 5_000)
}

function onFocus(): void {
  refreshIfDue(EVENT_MIN_GAP_MS)
}

function onWake(): void {
  if (wakeTimer) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => { wakeTimer = null; refreshIfDue(EVENT_MIN_GAP_MS) }, WAKE_DELAY_MS)
}

function refreshIfDue(minGapMs: number): void {
  if (!timer || running || Date.now() - lastStartedAt < minGapMs) return
  running = true
  lastStartedAt = Date.now()
  void backgroundSyncGoogleCalendar()
    .catch((error) => console.error('Background Google Calendar sync failed; it will retry later', error))
    .finally(() => { running = false })
}
