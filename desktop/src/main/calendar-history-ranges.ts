import type { CalendarHistoryRange } from '../shared/calendar-contract'
import type { MeetingInterval } from '../shared/calendar-reconciliation'

const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_HISTORY_RANGES = 120
export type CalendarRange = CalendarHistoryRange

export function historicalCalendarRanges(meetings: MeetingInterval[], now = Date.now()): CalendarRange[] {
  const intervals = meetings.map(meeting => ({ start: Date.parse(meeting.startedAt), end: Date.parse(meeting.endedAt ?? '') }))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start && range.end <= now)
    .sort((left, right) => left.start - right.start)
  const ranges: CalendarRange[] = []
  for (const interval of intervals) appendInterval(ranges, interval)
  return ranges
}

function appendInterval(ranges: CalendarRange[], interval: CalendarRange): void {
  let start = interval.start
  while (start < interval.end) {
    const last = ranges.at(-1)
    if (last && start <= last.end && interval.end - last.start <= MAX_RANGE_MS) {
      last.end = Math.max(last.end, interval.end)
      return
    }
    const end = Math.min(start + MAX_RANGE_MS, interval.end)
    ranges.push({ start, end })
    if (ranges.length > MAX_HISTORY_RANGES) throw new Error('Calendar history exceeds 120 ranges; historical overlap matching is unavailable.')
    start = end
  }
}
