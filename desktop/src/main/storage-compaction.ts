import { powerMonitor } from 'electron'
import { requestCommand } from './app-protocol'

// Finished Meetings are compacted in the background to save disk space: leftover Live Transcript chunks are removed
// and Screen videos are encoded again. The backend skips this while a Meeting records.
const FIRST_RUN_DELAY_MS = 2 * 60_000
const INTERVAL_MS = 10 * 60_000

let timer: NodeJS.Timeout | null = null
let running: AbortController | null = null

export function startStorageCompaction(): void {
  if (timer) return
  timer = setTimeout(function tick() {
    void compactStorage()
    timer = setTimeout(tick, INTERVAL_MS)
  }, FIRST_RUN_DELAY_MS)
}

export function stopStorageCompaction(): void {
  if (timer) clearTimeout(timer)
  timer = null
  running?.abort()
}

async function compactStorage(): Promise<void> {
  if (running) return
  const controller = new AbortController()
  running = controller
  try {
    // One movie per command keeps each run short. Battery power pauses the work until the next tick.
    while (timer && !controller.signal.aborted && !powerMonitor.isOnBatteryPower()) {
      const result = await requestCommand('meetings.compactStorage', {}, {}, controller.signal)
      if (result.savedBytes > 0) console.log(`Meeting storage compacted; saved ${Math.round(result.savedBytes / 1_000_000)} MB`)
      if (!result.attempted) break
    }
  } catch (error) {
    if (!controller.signal.aborted) console.error('Meeting storage compaction failed; it will retry later', error)
  } finally {
    running = null
  }
}
