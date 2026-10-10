import { powerMonitor } from 'electron'
import { requestCommand } from './app-protocol'

// Finished Screen videos are encoded again in the background to save disk space. The backend skips this while a Meeting records.
const FIRST_RUN_DELAY_MS = 2 * 60_000
const INTERVAL_MS = 10 * 60_000

let timer: NodeJS.Timeout | null = null
let running: AbortController | null = null

export function startVideoCompaction(): void {
  if (timer) return
  timer = setTimeout(function tick() {
    void compactVideos()
    timer = setTimeout(tick, INTERVAL_MS)
  }, FIRST_RUN_DELAY_MS)
}

export function stopVideoCompaction(): void {
  if (timer) clearTimeout(timer)
  timer = null
  running?.abort()
}

async function compactVideos(): Promise<void> {
  if (running) return
  const controller = new AbortController()
  running = controller
  try {
    // One movie per command keeps each run short. Battery power pauses the work until the next tick.
    while (timer && !controller.signal.aborted && !powerMonitor.isOnBatteryPower()) {
      const result = await requestCommand('meetings.compactVideo', {}, {}, controller.signal)
      if (!result.attempted) break
      if (result.savedBytes > 0) console.log(`Screen video compacted; saved ${Math.round(result.savedBytes / 1_000_000)} MB`)
    }
  } catch (error) {
    if (!controller.signal.aborted) console.error('Screen video compaction failed; it will retry later', error)
  } finally {
    running = null
  }
}
