import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { historicalCalendarRanges } from './calendar-history-ranges.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-01')
const interval = (start: number, end: number) => ({ startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString() })

test('requests actual completed historical intervals and merges overlaps', () => {
  const meetings = [interval(NOW - 3 * DAY, NOW - 2 * DAY), interval(NOW - 2.5 * DAY, NOW - DAY), interval(NOW, NOW + DAY), { startedAt: 'bad' }]
  assert.deepEqual(historicalCalendarRanges(meetings, NOW), [{ start: NOW - 3 * DAY, end: NOW - DAY }])
})

test('bounds each range to 30 days and rejects more than 120 ranges explicitly', () => {
  const ranges = historicalCalendarRanges([interval(NOW - 61 * DAY, NOW)], NOW)
  assert.equal(ranges.length, 3)
  assert.ok(ranges.every(range => range.end - range.start <= 30 * DAY))
  const meetings = Array.from({ length: 121 }, (_, index) => interval(NOW - (index * 2 + 1) * DAY, NOW - index * 2 * DAY))
  assert.throws(() => historicalCalendarRanges(meetings, NOW), /120 ranges/)
  assert.equal(historicalCalendarRanges(meetings.slice(0, 120), NOW).length, 120)
})
