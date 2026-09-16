import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { deferred, loadSourceModule } from './source-module-test-helper.ts'

function dashboardFixture() {
  let state: any, read = async (id: string) => meeting(id), list = async () => [meeting('a'), meeting('b')]
  const cleanup: (() => void)[] = []
  const react = { useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => { state = initial; return [state, (update: (current: unknown) => unknown) => { state = update(state) }] },
    useEffect: (effect: () => () => void) => cleanup.push(effect()), }
  const gate = loadSourceModule(new URL('../renderer/hooks/request-gate.ts', import.meta.url), { react })
  const module = loadSourceModule(new URL('../renderer/hooks/use-dashboard-data.ts', import.meta.url), {
    react, './request-gate': gate,
    '../components/meeting-status': { isPermissionErrorMessage: () => false },
    './use-dynamic-refresh': { useDynamicRefresh: () => {} }, './use-guarded-effect': { useGuardedEffect: () => {} },
    './use-meeting-recording-workflow': { useMeetingRecordingWorkflow: () => ({ actions: {}, recording: {} }) },
  }, { window: { gappd: { meetings: { list: () => list(), show: (id: string) => read(id) } } }, console })
  const view = module.useDashboardData(true)
  return { actions: view.actions, state: () => state, unmount: () => cleanup.forEach(fn => fn()),
    read: (next: typeof read) => { read = next }, list: (next: typeof list) => { list = next } }
}

function meeting(id: string, summary = 'old') {
  return { id, status: { capture: {} }, summary }
}

test('selected Meeting rejects delayed poll A after newer poll B', async () => {
  const f = dashboardFixture(), old = deferred<any>()
  f.read(() => old.promise)
  const first = f.actions.loadMeeting('a')
  f.read(async () => meeting('a', 'new'))
  await f.actions.loadMeeting('a')
  old.resolve(meeting('a'))
  await first
  assert.equal(f.state().selectedMeeting.summary, 'new')
})

test('meeting update cancels pending selected Meeting reads immediately', async () => {
  const f = dashboardFixture(), old = deferred<any>(), list = deferred<any>()
  await f.actions.loadMeeting('a')
  f.read(() => old.promise); f.list(() => list.promise)
  const reading = f.actions.loadMeeting('a')
  f.actions.updateMeeting(meeting('a', 'generated'))
  old.resolve(meeting('a'))
  await reading
  assert.equal(f.state().selectedMeeting.summary, 'generated')
})

test('navigation rejects a previous Meeting response and an older list refresh target', async () => {
  const f = dashboardFixture(), old = deferred<any>(), list = deferred<any>()
  f.read(id => id === 'a' ? old.promise : Promise.resolve(meeting(id)))
  const reading = f.actions.loadMeeting('a')
  f.list(() => list.promise)
  const refreshing = f.actions.refreshMeetings('a')
  await f.actions.loadMeeting('b')
  old.resolve(meeting('a')); list.resolve([meeting('a'), meeting('b')])
  await Promise.all([reading, refreshing])
  assert.equal(f.state().selectedMeeting.id, 'b')
})

test('background polling does not reopen the last recording after selecting an Agenda draft', async () => {
  const f = dashboardFixture()
  await f.actions.loadMeeting('a')
  f.actions.clearSelectedMeeting()
  let tick: () => Promise<void> = async () => {}
  const refresh = loadSourceModule(new URL('../renderer/hooks/use-dynamic-refresh.ts', import.meta.url), {
    react: { useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => unknown) => fn() },
    '../../shared/meeting-recording-workflow': { needsRecordingRefresh: () => false },
  }, {
    window: { addEventListener() {}, setInterval(fn: typeof tick) { tick = fn; return 1 } },
    document: { addEventListener() {} }, console,
  })
  refresh.useDynamicRefresh(true, [{ status: { state: 'pending' } }], { status: 'idle', meetingId: 'a' }, f.actions.refreshMeetings)
  await tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state().selectedMeetingId, null)
  await f.actions.loadMeeting('b')
  await tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state().selectedMeetingId, 'b')
})

test('unmount invalidates reads; remount reads the stored replacement', async () => {
  const first = dashboardFixture(), old = deferred<any>()
  first.read(() => old.promise)
  const reading = first.actions.loadMeeting('a')
  first.unmount()
  const second = dashboardFixture()
  second.read(async () => meeting('a', 'replacement'))
  await second.actions.loadMeeting('a')
  old.resolve(meeting('a')); await reading
  assert.equal(first.state().selectedMeeting, null)
  assert.equal(second.state().selectedMeeting.summary, 'replacement')
})
