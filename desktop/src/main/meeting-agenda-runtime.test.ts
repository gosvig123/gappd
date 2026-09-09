import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import * as calendarReconciliation from '../shared/calendar-reconciliation.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'

function fixture(provider: string) {
  const calls: string[] = []
  const generation = deferred<{ items: unknown[] }>()
  const requestCommand = async (id: string) => {
    if (id === 'config.show') return { ai: { provider } }
    if (id === 'meetings.agendaHistory') return { meetings: [{ id: 'previous', emails: [] }] }
    calls.push('generate'); return generation.promise
  }
  const runtime = loadSourceModule(new URL('./summary-runtime.ts', import.meta.url), {
    './app-protocol': { requestCommand },
    './managed-runtime': { managedRuntime: { using: async (capabilities: string[], work: () => Promise<unknown>) => {
      assert.equal(capabilities.join(','), 'summarization'); calls.push('acquire')
      try { return await work() } finally { calls.push('release') }
    } } },
  })
  return { calls, generation, requestCommand, runtime }
}

function loadAgenda(f: ReturnType<typeof fixture>) {
  return loadSourceModule(new URL('./meeting-agenda.ts', import.meta.url), {
    '../shared/calendar-reconciliation': calendarReconciliation,
    '../shared/meeting-agenda': { calendarEventIsUpcoming: () => true, inviteeEmails: () => ['partner@example.com'], matchAgendaHistory: () => [{ id: 'previous' }] },
    './app-protocol': { requestCommand: f.requestCommand },
    './google-calendar-service': { googleCalendarSnapshot: async () => ({ connections: [], events: [{ sourceId: 'next', title: 'Planning' }] }) },
    './participant-calendar': { savedMeetingCalendarContexts: async () => ({}) },
    './summary-runtime': f.runtime,
  }).generateMeetingAgenda
}

test('agenda holds Local AI lease until generation completes', async () => {
  const f = fixture('llamacpp')
  const pending = loadAgenda(f)('next')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.calls, ['acquire', 'generate'])
  f.generation.resolve({ items: [] })
  await pending
  assert.deepEqual(f.calls, ['acquire', 'generate', 'release'])
})

test('agenda releases Local AI lease after generation failure', async () => {
  const f = fixture('llamacpp')
  const pending = loadAgenda(f)('next')
  const rejected = assert.rejects(pending, /generation failed/)
  await new Promise(resolve => setImmediate(resolve))
  f.generation.reject(new Error('generation failed'))
  await rejected
  assert.deepEqual(f.calls, ['acquire', 'generate', 'release'])
})

test('Codex agenda generation bypasses Local AI acquisition', async () => {
  const f = fixture('codex_exec')
  f.generation.resolve({ items: [] })
  await loadAgenda(f)('next')
  assert.deepEqual(f.calls, ['generate'])
})
