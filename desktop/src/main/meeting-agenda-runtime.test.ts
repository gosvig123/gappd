import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import * as calendarReconciliation from '../shared/calendar-reconciliation.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'

function fixture(provider: string) {
  const calls: string[] = []
  const inputs: Array<{ input: unknown; stdin?: string }> = []
  const generation = deferred<{ items: unknown[] }>()
  const requestCommand = async (id: string, input?: unknown, _env?: unknown, _signal?: unknown, stdin?: string) => {
    if (id === 'config.show') return { ai: { provider } }
    if (id === 'meetings.agendaHistory') return { meetings: [{ id: 'previous', emails: [] }] }
    calls.push('generate'); inputs.push({ input, stdin }); return generation.promise
  }
  const runtime = loadSourceModule(new URL('./summary-runtime.ts', import.meta.url), {
    './app-protocol': { requestCommand },
    './managed-runtime': { managedRuntime: { using: async (capabilities: string[], work: () => Promise<unknown>) => {
      assert.equal(capabilities.join(','), 'summarization'); calls.push('acquire')
      try { return await work() } finally { calls.push('release') }
    } } },
  })
  return { calls, generation, requestCommand, runtime, inputs }
}

const defaultPersist = async (input: { draft: unknown }) => ({ draft: input.draft, saved: true, revision: 1, generatedAt: '2026-01-01T00:00:00.000Z', model: 'gpt-5.6-terra', reasoningEffort: 'medium' })

function loadAgenda(f: ReturnType<typeof fixture>, persistGeneratedAgenda: (input: { draft: unknown }) => Promise<unknown> = defaultPersist, communicationOnly = false) {
  return loadSourceModule(new URL('./meeting-agenda.ts', import.meta.url), {
    '../shared/calendar-reconciliation': calendarReconciliation,
    '../shared/meeting-agenda': { calendarEventIsUpcoming: () => true, inviteeEmails: () => ['partner@example.com'], matchAgendaHistory: () => communicationOnly ? [] : [{ id: 'previous' }] },
    './app-protocol': { requestCommand: f.requestCommand },
    './slack-service': { slackAgendaCommunication: async () => ({ sources: communicationOnly ? [{ id: 'slack:team:dm:123', kind: 'slack', title: 'Slack DM', startedAt: '2026-01-02T00:00:00Z', text: 'The launch review is completed.' }] : [] }) },
    './slack-agenda': { agendaSlackChannels: (ids: string[] = []) => ids },
    './google-calendar-service': { googleAgendaCommunication: async () => ({ sources: communicationOnly ? [{ id: 'gmail:account:aa', kind: 'gmail', title: 'Gmail: Launch', startedAt: '2026-01-01T00:00:00Z', text: 'Please confirm the launch review date.' }] : [] }), googleCalendarPendingSyncIds: () => [], googleCalendarSnapshot: async () => ({ connections: [], events: [{ sourceId: 'next', title: 'Planning' }] }) },
    './participant-calendar': { savedMeetingCalendarContexts: async () => ({}) },
    './summary-runtime': f.runtime,
    './agenda-drafts': { persistGeneratedAgenda },
  }, { AbortSignal }).generateMeetingAgenda
}

test('agenda holds Local AI lease until generation completes', async () => {
  const f = fixture('llamacpp')
  const pending = loadAgenda(f)({ sourceId: 'next', expectedRevision: 0 })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.calls, ['acquire', 'generate'])
  f.generation.resolve({ items: [] })
  await pending
  assert.deepEqual(f.calls, ['acquire', 'generate', 'release'])
})

test('agenda releases Local AI lease after generation failure', async () => {
  const f = fixture('llamacpp')
  const pending = loadAgenda(f)({ sourceId: 'next', expectedRevision: 0 })
  const rejected = assert.rejects(pending, /generation failed/)
  await new Promise(resolve => setImmediate(resolve))
  f.generation.reject(new Error('generation failed'))
  await rejected
  assert.deepEqual(f.calls, ['acquire', 'generate', 'release'])
})

test('Codex agenda failures preserve the Saved Agenda draft and model metadata', { timeout: 1000 }, async () => {
  for (const message of ['ABSENT_NEW_QUOTE', 'malformed rolling response', '96 model-request budget exhausted', 'authentication unavailable', 'context canceled']) {
    const f = fixture('codex_exec')
    const previous = { draft: { items: [{ topic: 'User edit', sourceId: 'previous', quote: 'Exact prior evidence.' }] }, model: 'gpt-5.6-terra', reasoningEffort: 'medium', revision: 7 }
    let saved: { draft: unknown; model: string; reasoningEffort: string; revision: number } = structuredClone(previous)
    let writes = 0
    const generate = loadAgenda(f, async input => { writes++; saved = { ...saved, draft: input.draft, model: 'unexpected' }; return saved })
    const pending = generate({ sourceId: 'next', expectedRevision: 7 })
    const rejected = assert.rejects(pending, error => error instanceof Error && error.message === message)
    await new Promise(resolve => setImmediate(resolve))
    f.generation.reject(new Error(message))
    await rejected
    assert.equal(writes, 0)
    assert.deepEqual(saved, previous)
    assert.deepEqual(f.calls, ['generate'])
  }
})

test('both providers receive Gmail and Slack over stdin without any matched Meeting', async () => {
  for (const provider of ['llamacpp', 'codex_exec']) {
    const f = fixture(provider)
    f.generation.resolve({ items: [] })
    const result = await loadAgenda(f, defaultPersist, true)({ sourceId: 'next', expectedRevision: 0 })
    assert.equal(f.inputs.length, 1)
    assert.equal((f.inputs[0].input as { meetingIds: string }).meetingIds, '')
    const evidence = JSON.parse(f.inputs[0].stdin!)
    assert.deepEqual(evidence.map((source: { kind: string }) => source.kind), ['gmail', 'slack'])
    assert.match(evidence[1].text, /completed/)
    assert.ok(result.draft.sources.every((source: { text?: string }) => source.text === undefined))
    assert.deepEqual(f.calls, provider === 'llamacpp' ? ['acquire', 'generate', 'release'] : ['generate'])
  }
})

test('Codex agenda generation bypasses Local AI acquisition', async () => {
  const f = fixture('codex_exec')
  f.generation.resolve({ items: [] })
  await loadAgenda(f)({ sourceId: 'next', expectedRevision: 0 })
  assert.deepEqual(f.calls, ['generate'])
})
