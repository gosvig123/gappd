import { spawn } from 'node:child_process'
import {
  APP_COMMANDS,
  type AppCommandInput,
  type AppCommandOutput,
  type AppRequestID,
  type AppStreamEvent,
  type AppStreamID,
} from '../shared/generated/app-protocol'
import { RECORDING_PROTOCOL_EVENT_TYPES } from '../shared/generated/protocol'
import { childEnv, resolveCaptureApp, resolveCaptureBinary, resolveDiarizationModels, resolveDiarizerBinary, resolveGappdBinary, resolveSpeechTranscriberBinary } from './native-runtime'

type StreamHandlers<ID extends AppStreamID> = {
  onEvent(event: AppStreamEvent<ID>): void
  onError(error: string): void
  onExitWithoutTerminal(): void
}

type CommandEnv = NodeJS.ProcessEnv

const PROCESSING_TIMING_MARKER = '● Timing '

export async function requestCommand<ID extends AppRequestID>(id: ID, input: AppCommandInput[ID], env: CommandEnv = {}, signal?: AbortSignal): Promise<AppCommandOutput[ID]> {
  const output = await runCommand(id, commandArgs(id, input), env, signal)
  return parseCommandOutput(id, output)
}

export function streamCommand<ID extends AppStreamID>(id: ID, input: AppCommandInput[ID], handlers: StreamHandlers<ID>, env: CommandEnv = {}): ReturnType<typeof spawn> {
  const child = spawn(resolveGappdBinary(), commandArgs(id, input), { env: commandEnvFor(id, env), stdio: ['ignore', 'pipe', 'pipe'] })
  wireStream(child, id, handlers)
  return child
}

export function commandEnv(overrides: CommandEnv = {}): CommandEnv {
  return childEnv({ GAPPD_CAPTURE_APP_PATH: resolveCaptureApp() ?? '', GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary(), GAPPD_APPLE_SPEECH_BIN: resolveSpeechTranscriberBinary(), GAPPD_DIARIZER_BIN: resolveDiarizerBinary(), GAPPD_DIARIZATION_MODELS: resolveDiarizationModels(), ...overrides })
}

function commandArgs<ID extends keyof AppCommandInput>(id: ID, input: AppCommandInput[ID]): string[] {
  return APP_COMMANDS[id].args(input as never)
}

function runCommand<ID extends AppRequestID>(id: ID, args: string[], env: CommandEnv, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGappdBinary(), args, { env: commandEnvFor(id, env), signal, stdio: ['ignore', 'pipe', 'pipe'] })
    collectCommandOutput(child, resolve, reject, signal)
  })
}

function commandEnvFor<ID extends keyof AppCommandInput>(id: ID, overrides: CommandEnv): CommandEnv {
  const env = commandEnv(overrides)
  const missing = APP_COMMANDS[id].env.filter((name) => !env[name])
  if (missing.length > 0) throw new Error(`gappd command ${id} missing required env: ${missing.join(', ')}`)
  return env
}

function parseCommandOutput<ID extends AppRequestID>(id: ID, output: string): AppCommandOutput[ID] {
  try {
    return JSON.parse(output) as AppCommandOutput[ID]
  } catch (error) {
    throw new Error(`Invalid JSON from gappd command ${id}: ${errorMessage(error)}. Output: ${preview(output)}`)
  }
}

function collectCommandOutput(child: ReturnType<typeof spawn>, resolve: (stdout: string) => void, reject: (error: Error) => void, signal?: AbortSignal): void {
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('error', (error) => signal?.aborted ? child.once('close', () => reject(error)) : reject(error))
  child.on('exit', (code) => {
    if (code !== 0) return reject(new Error(stderr || stdout || `gappd exited with code ${code}`))
    if (stderr.trim()) console.warn(stderr.trim())
    resolve(stdout)
  })
}

function wireStream<ID extends AppStreamID>(child: ReturnType<typeof spawn>, id: ID, handlers: StreamHandlers<ID>): void {
  let stderr = ''
  let settled = false
  const state = { buffer: '', sawEvent: false, sawTerminal: false, protocolError: null as string | null }
  child.stdout?.on('data', (chunk) => readProtocolChunk(id, state, chunk.toString(), handlers))
  child.stderr?.on('data', (chunk) => { stderr = captureStreamStderr(stderr, chunk.toString()) })
  child.once('error', (error) => {
    if (settled) return
    settled = true
    handlers.onError(error.message)
  })
  child.once('close', (code, signal) => {
    if (settled) return
    settled = true
    finishStream(state, stderr, code, signal, handlers)
  })
}

function captureStreamStderr(current: string, chunk: string): string {
  if (chunk.includes(PROCESSING_TIMING_MARKER)) console.info(chunk.trim())
  return current + chunk
}

function readProtocolChunk<ID extends AppStreamID>(id: ID, state: StreamState, chunk: string, handlers: StreamHandlers<ID>): void {
  state.buffer += chunk
  const lines = state.buffer.split('\n')
  state.buffer = lines.pop() ?? ''
  for (const line of lines) readProtocolLine(id, state, line, handlers)
}

type StreamState = { buffer: string; sawEvent: boolean; sawTerminal: boolean; protocolError: string | null }

function readProtocolLine<ID extends AppStreamID>(id: ID, state: StreamState, line: string, handlers: StreamHandlers<ID>): void {
  const trimmed = line.trim()
  if (!trimmed) return
  const result = parseProtocolEvent<ID>(id, trimmed)
  if (!result.ok) {
    state.protocolError = result.error
    return
  }
  state.sawEvent = true
  if (isTerminalEvent(id, result.event)) state.sawTerminal = true
  handlers.onEvent(result.event)
}

type ProtocolParseResult<ID extends AppStreamID> = { ok: true; event: AppStreamEvent<ID> } | { ok: false; error: string }

function parseProtocolEvent<ID extends AppStreamID>(id: ID, line: string): ProtocolParseResult<ID> {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch (error) { return { ok: false, error: `Invalid JSON from gappd stream ${id}: ${errorMessage(error)}. Line: ${preview(line)}` } }
  if (!hasProtocolEventShape(parsed)) return { ok: false, error: `Invalid protocol event from gappd stream ${id}: ${preview(line)}` }
  if (!isKnownRecordingEvent(parsed.type)) return { ok: false, error: `Unexpected protocol event ${parsed.type} from gappd stream ${id}` }
  return { ok: true, event: parsed as AppStreamEvent<ID> }
}

function hasProtocolEventShape(event: unknown): event is { type: string; meetingId: string; title: string; status: object } {
  if (!event || typeof event !== 'object') return false
  const candidate = event as { type?: unknown; meetingId?: unknown; title?: unknown; status?: unknown }
  return typeof candidate.type === 'string' && typeof candidate.meetingId === 'string' && typeof candidate.title === 'string' && isObject(candidate.status)
}

function isKnownRecordingEvent(type: string): boolean {
  return (RECORDING_PROTOCOL_EVENT_TYPES as readonly string[]).includes(type)
}

function isObject(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object'
}

function isTerminalEvent<ID extends AppStreamID>(id: ID, event: AppStreamEvent<ID>): boolean {
  const terminal: readonly string[] = APP_COMMANDS[id].terminal
  return terminal.includes(event.type)
}

function finishStream<ID extends AppStreamID>(state: StreamState, stderr: string, code: number | null, signal: NodeJS.Signals | null, handlers: StreamHandlers<ID>): void {
  if (state.protocolError) return handlers.onError(state.protocolError)
  if (state.sawTerminal) return
  if (state.buffer.trim()) return handlers.onError(`Incomplete recording protocol event: ${state.buffer.trim()}`)
  if (code === 0 && !state.sawEvent) return handlers.onExitWithoutTerminal()
  if (signal === 'SIGINT') return handlers.onExitWithoutTerminal()
  handlers.onError(formatChildError(stderr, code, signal))
}

function formatChildError(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const cleaned = stderr.trim()
  if (!cleaned) return code === null ? `Process exited with signal ${signal}` : `Process exited with code ${code}`
  return cleaned.split('\n').filter(Boolean).slice(-8).join('\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function preview(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > 240 ? `${normalized.slice(0, 240)}…` : normalized
}
