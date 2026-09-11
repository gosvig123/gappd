import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { loadSourceModule } from './source-module-test-helper.ts'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
}

const COMMANDS = {
  'test.request': { args: () => ['request'], env: [], terminal: [] },
  'test.stream': { args: () => ['stream'], env: [], terminal: ['recording.completed'] },
}
const NATIVE = { childEnv: (overrides: unknown) => overrides, resolveCaptureApp: () => null, resolveCaptureBinary: () => '', resolveDiarizationModels: () => '', resolveDiarizerBinary: () => '', resolveGappdBinary: () => 'gappd', resolveSpeechTranscriberBinary: () => '' }

function protocol(child: FakeChild) {
  return loadSourceModule(new URL('./app-protocol.ts', import.meta.url), {
    'node:child_process': { spawn: () => child },
    '../shared/generated/app-protocol': { APP_COMMANDS: COMMANDS },
    '../shared/generated/protocol': { RECORDING_PROTOCOL_EVENT_TYPES: ['recording.completed'] },
    './native-runtime': NATIVE,
  }, { console })
}

function writePerByte(stream: PassThrough, value: string): void {
  for (const byte of Buffer.from(value, 'utf8')) stream.write(Buffer.from([byte]))
}

test('a command response waits for stdout that follows exit', async () => {
  const child = new FakeChild()
  const pending = protocol(child).requestCommand('test.request', {})
  child.stdout.write('{"ok":')
  child.emit('exit', 0)
  child.stdout.write('true}')
  child.emit('close', 0, null)
  assert.equal((await pending).ok, true)
})

test('per-byte pipes keep split accented and emoji characters in both paths', async () => {
  const title = 'café 🎉'
  const request = new FakeChild()
  const pending = protocol(request).requestCommand('test.request', {})
  writePerByte(request.stdout, JSON.stringify({ title }))
  request.emit('close', 0, null)
  assert.equal((await pending).title, title)

  const events: unknown[] = []
  const stream = new FakeChild()
  protocol(stream).streamCommand('test.stream', {}, {
    onEvent: (event: unknown) => events.push(event),
    onError: (message: string) => { throw new Error(`stream error: ${message}`) },
    onExitWithoutTerminal: () => { throw new Error('stream ended without a terminal event') },
  })
  writePerByte(stream.stdout, `${JSON.stringify({ type: 'recording.completed', meetingId: 'm', title, status: {} })}\n`)
  stream.emit('close', 0, null)
  assert.equal(events.length, 1)
  assert.equal((events[0] as { title: string }).title, title)
})

test('a failed command reports stderr and an aborted command rejects with its error', async () => {
  const failed = new FakeChild()
  const failing = protocol(failed).requestCommand('test.request', {})
  failed.stderr.write('transcription helper failed')
  failed.emit('close', 2, null)
  await assert.rejects(failing, /transcription helper failed/)

  const aborted = new FakeChild()
  const interrupting = protocol(aborted).requestCommand('test.request', {}, {}, AbortSignal.abort())
  aborted.emit('error', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
  aborted.emit('close', null, 'SIGTERM')
  await assert.rejects(interrupting, { name: 'AbortError' })
})
