import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error explicit extension for Node tests
import { loadSourceModule } from './source-module-test-helper.ts'

test('relink persists constraint before requesting processing; reading preserves confirmed snapshot', { timeout: 2000 }, async () => {
  const old = { sourceId: 'event', accountEmail: 'me', title: 'old', attendees: [{ email: 'old@example.test' }] }
  const fresh = { ...old, title: 'fresh', attendees: [{ email: 'new@example.test' }] }
  const document = { version: 1, meetings: { meeting: { event: old, candidates: [old] } } }
  const calls: string[] = []
  const module = loadSourceModule(new URL('./participant-calendar.ts', import.meta.url), {
    './app-protocol': { requestCommand: async () => ({ meeting: { startedAt: '2026-01-01' } }) },
    './electron-secure-store': { createSecureStore: () => ({ read: async () => document, write: async () => { calls.push('save') } }) },
    './google-calendar-service': { googleCalendarSnapshot: async () => ({ events: [fresh] }) },
    './drain-coordinator': { requestDrains: () => { calls.push('drain') } },
  })
  assert.equal((await module.participantContext('meeting')).event.title, 'old')
  assert.equal(calls.includes('drain'), false)
  const linked = await module.linkCalendar({ id: 'meeting', eventSourceId: 'event' })
  assert.equal(linked.event.title, 'fresh')
  assert.deepEqual(calls.slice(-2), ['save', 'drain'])
})
