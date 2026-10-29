import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

function meetings(deleteResult: () => Promise<unknown>, cleanup: () => Promise<void>, agendaCleanup: (id: string) => Promise<void> = async () => {}) {
  return loadSourceModule(new URL('./meetings.ts', import.meta.url), {
    './app-protocol': { requestCommand: deleteResult },
    './drain-coordinator': { requestDrains() {} },
    './participant-calendar': { forgetMeetingCalendar: cleanup },
    './agenda': { forgetAgendaMeeting: agendaCleanup },
  }, { console: { error() {} } })
}

test('failed Meeting deletion never sends managed paths to the renderer', async () => {
  const module = meetings(async () => { throw new Error('delete artifacts /private/tmp/managed/screen.mov: permission denied') }, async () => {})
  await assert.rejects(module.deleteMeeting('test-id'), (error: Error) => {
    assert.match(error.message, /check managed-file permissions.*retry/)
    assert.doesNotMatch(error.message, /private\/tmp|screen\.mov/)
    return true
  })
})

test('context cleanup warning remains path-free after Meeting deletion', async () => {
  const module = meetings(async () => ({ deletedId: 'test-id' }), async () => { throw new Error('/private/tmp/managed/calendar.json') })
  const result = await module.deleteMeeting('test-id')
  assert.equal(result.deletedId, 'test-id')
  assert.match(result.artifactWarning, /related local context/)
  assert.doesNotMatch(result.artifactWarning, /private\/tmp|calendar\.json/)
})

test('Meeting deletion removes Agenda sources even if Calendar cleanup fails', async () => {
  const removed: string[] = []
  const module = meetings(async () => ({ deletedId: 'test-id' }), async () => { throw new Error('Calendar cleanup failed') }, async (id) => { removed.push(id) })
  await module.deleteMeeting('test-id')
  assert.deepEqual(removed, ['test-id'])
})

test('Agenda cleanup warning remains path-free after Meeting deletion', async () => {
  const module = meetings(async () => ({ deletedId: 'test-id' }), async () => {}, async () => { throw new Error('/private/tmp/managed/meeting-agendas.enc') })
  const result = await module.deleteMeeting('test-id')
  assert.match(result.artifactWarning, /related local context/)
  assert.doesNotMatch(result.artifactWarning, /private\/tmp|meeting-agendas\.enc/)
})
