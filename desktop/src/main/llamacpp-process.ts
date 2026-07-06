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
const SHUTDOWN_TIMEOUT_MS = 5_000

export function spawnLlamaCpp(binaryPath: string, args: string[], env: NodeJS.ProcessEnv): LlamaCppChild {
  return spawn(binaryPath, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })
}

export async function waitForLlamaCppReadiness(input: ReadinessInput): Promise<void> {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const startupError = input.startupError()
    if (startupError) throw new Error(startupError)
    if (await processServesEndpoint(input.child, input.port, input.endpoint)) return
    if ((await listenerPid(input.port)) !== null && !(await processOwnsPort(input.child, input.port))) throw portBindError(input.port)
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS))
  }
  throw new Error(`Managed llama.cpp did not become ready in time at ${input.binaryPath}`)
}

export async function processServesEndpoint(child: LlamaCppChild | null, port: number, endpoint: string): Promise<boolean> {
  if (!(await processOwnsPort(child, port))) return false
  if (!(await endpointHealthy(endpoint))) return false
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

async function endpointHealthy(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/v1/models`)
    return response.ok
  } catch {
    return false
  }
}

function listenerPid(port: number): Promise<number | null> {
  return new Promise((resolve) => execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (_error, stdout) => resolve(parsePid(stdout))))
}

function parsePid(stdout: string): number | null {
  const pid = Number.parseInt(stdout.trim().split('\n')[0] || '', 10)
  return Number.isInteger(pid) ? pid : null
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
