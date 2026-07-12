import { execFile, spawn } from 'node:child_process'
import net from 'node:net'
import { MANAGED_LLAMACPP_HOST, MANAGED_LLAMACPP_PORT } from '../shared/managed-local-ai'

export type LlamaCppChild = ReturnType<typeof spawn>

type ReadinessInput = {
  child: LlamaCppChild
  binaryPath: string
  port: number
  endpoint: string
  startupError: () => string | null
}

const READINESS_ATTEMPTS = 120
const READINESS_INTERVAL_MS = 500
const READINESS_TIMEOUT_MS = READINESS_ATTEMPTS * READINESS_INTERVAL_MS
const HEALTH_CHECK_TIMEOUT_MS = 2_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const SHUTDOWN_POLL_INTERVAL_MS = 50

export function spawnLlamaCpp(binaryPath: string, args: string[], env: NodeJS.ProcessEnv): LlamaCppChild {
  return spawn(binaryPath, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })
}

export async function waitForLlamaCppReadiness(input: ReadinessInput): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    const startupError = input.startupError()
    if (startupError) throw new Error(startupError)
    if (await processServesEndpoint(input.child, input.port, input.endpoint, Math.min(HEALTH_CHECK_TIMEOUT_MS, remainingMs))) return
    if ((await listenerPid(input.port)) !== null && !(await processOwnsPort(input.child, input.port))) throw portBindError(input.port)
    await sleepBeforeRetry(deadline)
  }
  throw new Error(`Managed llama.cpp did not become ready in time at ${input.binaryPath}`)
}

export async function processServesEndpoint(child: LlamaCppChild | null, port: number, endpoint: string, timeoutMs = HEALTH_CHECK_TIMEOUT_MS): Promise<boolean> {
  if (!(await processOwnsPort(child, port))) return false
  if (!(await endpointHealthy(endpoint, timeoutMs))) return false
  return processOwnsPort(child, port)
}

export async function chooseLlamaCppPort(): Promise<number> {
  if (await portAvailable(MANAGED_LLAMACPP_PORT)) return MANAGED_LLAMACPP_PORT
  return freeLocalPort()
}

export async function stopLlamaCppProcess(child: LlamaCppChild): Promise<void> {
  child.kill('SIGTERM')
  await waitForExit(child)
}

export async function reclaimStaleLlamaCppProcess(child: LlamaCppChild | null, binaryPath: string, port: number): Promise<boolean> {
  const pid = await listenerPid(port)
  if (pid === null || pid === child?.pid) return false
  if ((await processExecutable(pid)) !== binaryPath) return false
  await stopProcessByPid(pid, binaryPath)
  return true
}

export function isLlamaCppPortBindError(error: unknown): boolean {
  return error instanceof Error && /port .*in use|address already in use|EADDRINUSE/i.test(error.message)
}

function portAvailable(port: number): Promise<boolean> {
  return probeLocalPort(port).then((server) => closeLocalServer(server).then(() => true), () => false)
}

async function freeLocalPort(): Promise<number> {
  const server = await probeLocalPort(0)
  const address = server.address()
  await closeLocalServer(server)
  if (!address || typeof address === 'string') throw new Error('Failed to reserve a local port for managed llama.cpp.')
  return address.port
}

function probeLocalPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, MANAGED_LLAMACPP_HOST, () => resolve(server))
  })
}

function closeLocalServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function portBindError(port: number): Error {
  return new Error(`Managed llama.cpp local port ${port} is already in use.`)
}

function processRunning(child: LlamaCppChild | null): child is LlamaCppChild & { pid: number } {
  return Boolean(child?.pid && !child.killed && child.exitCode === null && child.signalCode === null)
}

async function processOwnsPort(child: LlamaCppChild | null, port: number): Promise<boolean> {
  return processRunning(child) && (await listenerPid(port)) === child.pid
}

async function endpointHealthy(endpoint: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

async function sleepBeforeRetry(deadline: number): Promise<void> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, Math.min(READINESS_INTERVAL_MS, remainingMs)))
}

function listenerPid(port: number): Promise<number | null> {
  return new Promise((resolve) => execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (_error, stdout) => resolve(parsePid(stdout))))
}

function processExecutable(pid: number): Promise<string | null> {
  return new Promise((resolve) => execFile('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], (_error, stdout) => resolve(parseExecutable(stdout))))
}

function parseExecutable(stdout: string): string | null {
  const path = stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1)
  return path || null
}

function parsePid(stdout: string): number | null {
  const pid = Number.parseInt(stdout.trim().split('\n')[0] || '', 10)
  return Number.isInteger(pid) ? pid : null
}

async function stopProcessByPid(pid: number, binaryPath: string): Promise<void> {
  if ((await processExecutable(pid)) !== binaryPath) return
  signalProcess(pid, 'SIGTERM')
  if (await waitForPidExit(pid, binaryPath)) return
  signalProcess(pid, 'SIGKILL')
  if (!(await waitForPidExit(pid, binaryPath))) throw new Error(`Failed to stop stale managed llama.cpp process ${pid} at ${binaryPath}; stop it manually, then retry.`)
}

async function waitForPidExit(pid: number, binaryPath: string): Promise<boolean> {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if ((await processExecutable(pid)) !== binaryPath) return true
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_INTERVAL_MS))
  }
  return (await processExecutable(pid)) !== binaryPath
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(pid, signal) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function waitForExit(child: LlamaCppChild): Promise<void> {
  return new Promise((resolve) => {
    if (childExited(child)) return resolve()
    const timer = setTimeout(() => { if (!childExited(child)) child.kill('SIGKILL') }, SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function childExited(child: LlamaCppChild): boolean {
  return child.exitCode !== null || child.signalCode !== null
}
