import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error explicit extension for Node tests
import { loadSourceModule } from './source-module-test-helper.ts'

function fixture(fail = false) {
  const calls: string[] = []
  let locked = false
  const module = loadSourceModule(new URL('./speaker-recognition.ts', import.meta.url), {
    './participant-calendar': { withSavedCalendarContexts: async (work: (contexts: object) => Promise<void>) => {
      locked = true
      try { await work({ old: { event: event(), candidates: [] } }) } finally { locked = false }
    } },
    './app-protocol': { requestCommand: async (command: string, input: Record<string, unknown>) => {
      assert.equal(locked, true); calls.push(command)
      if (command === 'meetings.voiceTargets') return { targets: input.after ? [] : [{ id: 'old', revision: 7 }] }
      assert.deepEqual(JSON.parse(JSON.stringify(input)), { id: 'old', revision: 7, calendar: true, emails: 'guest@example.test' })
      if (fail) throw new Error('stale revision')
      return {}
    } },
  })
  return { module, calls }
}

function event() {
  return { accountEmail: 'me@example.test', attendees: [{ email: 'ME@example.test' }, { email: 'another-self@example.test', self: true }, { email: ' Guest@example.test ' }] }
}

test('speaker processing paginates old meetings and holds confirmed snapshot through mutation', { timeout: 2000 }, async () => {
  const f = fixture()
  await f.module.recognizePendingSpeakers()
  assert.deepEqual(f.calls, ['meetings.voiceTargets', 'meetings.recognizeSpeakers', 'meetings.voiceTargets'])
  await f.module.recognizePendingSpeakers()
  assert.equal(f.calls.length, 6) // Recovery repeats the backend idempotent operation.
})

test('only explicit Calendar snapshots constrain identities; candidates do not identify anyone', () => {
  const f = fixture()
  assert.equal(f.module.speakerConstraint({ candidates: [event()] }).calendar, false)
  assert.equal(f.module.speakerConstraint({ event: { accountEmail: 'me@example.test' } }).emails, '')
  assert.equal(f.module.speakerConstraint({ event: { accountEmail: 'me@example.test' } }).calendar, true)
  assert.throws(() => f.module.speakerConstraint({ event: { ...event(), attendees: [{ email: 'bad,extra@example.test' }] } }), /limits/)
})

test('failed Meeting recognition remains retryable without blocking other processing', { timeout: 2000 }, async () => {
  const f = fixture(true)
  await f.module.recognizePendingSpeakers()
  assert.equal(f.calls.length, 3)
})

test('oversized Calendar constraint skips only its Meeting', { timeout: 2000 }, async () => {
  const recognized: string[] = []
  const oversized = { event: { ...event(), attendees: Array.from({ length: 101 }, (_, i) => ({ email: `${i}@example.test` })) } }
  const module = loadSourceModule(new URL('./speaker-recognition.ts', import.meta.url), {
    './participant-calendar': { withSavedCalendarContexts: async (work: (contexts: object) => Promise<void>) => work({ bad: oversized }) },
    './app-protocol': { requestCommand: async (command: string, input: Record<string, unknown>) => {
      if (command === 'meetings.voiceTargets') return { targets: input.after ? [] : [{ id: 'bad', revision: 1 }, { id: 'good', revision: 1 }] }
      recognized.push(String(input.id))
      return {}
    } },
  })
  await module.recognizePendingSpeakers()
  assert.deepEqual(recognized, ['good'])
})
