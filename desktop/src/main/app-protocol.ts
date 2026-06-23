import { spawn } from 'node:child_process'
import {
  APP_COMMANDS,
  type AppCommandInput,
  type AppCommandOutput,
  type AppRequestID,
  type AppStreamEvent,
  type AppStreamID,
} from '../shared/generated/app-protocol'
import { childEnv, resolveCaptureApp, resolveCaptureBinary, resolveGappdBinary } from './native-runtime'

type StreamHandlers<ID extends AppStreamID> = {
  onEvent(event: AppStreamEvent<ID>): void
  onError(error: string): void
  onExitWithoutTerminal(): void
}

type CommandEnv = NodeJS.ProcessEnv

export async function requestCommand<ID extends AppRequestID>(id: ID, input: AppCommandInput[ID], env: CommandEnv = {}): Promise<AppCommandOutput[ID]> {
  const output = await runCommand(commandArgs(id, input), env)
  return JSON.parse(output) as AppCommandOutput[ID]
}

export function streamCommand<ID extends AppStreamID>(id: ID, input: AppCommandInput[ID], handlers: StreamHandlers<ID>, env: CommandEnv = {}): ReturnType<typeof spawn> {
  const child = spawn(resolveGappdBinary(), commandArgs(id, input), { env: commandEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
  wireStream(child, id, handlers)
  return child
}

export function commandEnv(overrides: CommandEnv = {}): CommandEnv {
  return childEnv({ GAPPD_CAPTURE_APP_PATH: resolveCaptureApp() ?? '', GAPPD_CAPTURE_HELPER_PATH: resolveCaptureBinary(), ...overrides })
}

function commandArgs<ID extends keyof AppCommandInput>(id: ID, input: AppCommandInput[ID]): string[] {
  return APP_COMMANDS[id].args(input as never)
}

function runCommand(args: string[], env: CommandEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGappdBinary(), args, { env: commandEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
    collectCommandOutput(child, resolve, reject)
  })
}

function collectCommandOutput(child: ReturnType<typeof spawn>, resolve: (stdout: string) => void, reject: (error: Error) => void): void {
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `gappd exited with code ${code}`)))
}

function wireStream<ID extends AppStreamID>(child: ReturnType<typeof spawn>, id: ID, handlers: StreamHandlers<ID>): void {
  let stderr = ''
  const state = { buffer: '', sawEvent: false, sawTerminal: false, protocolError: null as string | null }
  child.stdout?.on('data', (chunk) => readProtocolChunk(id, state, chunk.toString(), handlers))
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('error', (error) => handlers.onError(error.message))
  child.on('exit', (code, signal) => finishStream(state, stderr, code, signal, handlers))
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
  const event = parseProtocolEvent<ID>(trimmed)
  if (!event) {
    state.protocolError = `Invalid protocol event JSON: ${trimmed}`
    return
  }
  state.sawEvent = true
  if (isTerminalEvent(id, event)) state.sawTerminal = true
  handlers.onEvent(event)
}

function parseProtocolEvent<ID extends AppStreamID>(line: string): AppStreamEvent<ID> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return hasProtocolEventShape(parsed) ? parsed as AppStreamEvent<ID> : null
  } catch {
    return null
  }
}

function hasProtocolEventShape(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const candidate = event as { type?: unknown; meetingId?: unknown; title?: unknown; status?: unknown }
  return typeof candidate.type === 'string' && typeof candidate.meetingId === 'string' && typeof candidate.title === 'string' && Boolean(candidate.status)
}

function isTerminalEvent<ID extends AppStreamID>(id: ID, event: AppStreamEvent<ID>): boolean {
  const terminal: readonly string[] = APP_COMMANDS[id].terminal
  return terminal.includes(event.type)
}

function finishStream<ID extends AppStreamID>(state: StreamState, stderr: string, code: number | null, signal: NodeJS.Signals | null, handlers: StreamHandlers<ID>): void {
  if (state.sawTerminal) return
  if (state.protocolError) return handlers.onError(state.protocolError)
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
