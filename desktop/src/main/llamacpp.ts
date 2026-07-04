import { execFile, spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { app } from 'electron'
import { BUNDLED_LLAMACPP_BINARY_NAME, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_HOST, MANAGED_LLAMACPP_MODEL, MANAGED_LLAMACPP_PORT } from '../shared/managed-local-ai'
import { lastLines } from '../shared/subprocess-output'
import { isExecutableFile, resolveBinary } from './binaries'
import { childEnv } from './native-runtime'
import { managedLanguageModelAvailable, managedLanguageModelPath } from './language-model'
import { type LocalAISetupErrorState, toLocalAISetupErrorState } from './local-ai-setup-errors'

type LlamaCppRuntime = { process: ReturnType<typeof spawn> | null; startPromise: Promise<void> | null; ownedBySession: boolean; endpoint: string; lastError?: LocalAISetupErrorState }
export type ManagedLlamaCppRuntimeStatus = { supported: boolean; bundled: boolean; running: boolean; endpoint: string; error?: LocalAISetupErrorState }

const runtime: LlamaCppRuntime = { process: null, startPromise: null, ownedBySession: false, endpoint: MANAGED_LLAMACPP_ENDPOINT }
const SHUTDOWN_TIMEOUT_MS = 5_000

export function resolveBundledLlamaCppBinary(): string {
  return resolveBinary({ packaged: ['llamacpp', BUNDLED_LLAMACPP_BINARY_NAME], dev: ['resources', 'llamacpp', BUNDLED_LLAMACPP_BINARY_NAME] })
}
export function managedLlamaCppSupported(): boolean { return process.platform === 'darwin' }
export function managedLlamaCppEndpoint(): string { return runtime.endpoint }

export async function getManagedLlamaCppRuntimeStatus(): Promise<ManagedLlamaCppRuntimeStatus> {
  const supported = managedLlamaCppSupported()
  const bundled = supported ? await bundledLlamaCppAvailable() : false
  const running = bundled ? await managedLlamaCppReadiness() : false
  return { supported, bundled, running, endpoint: runtime.endpoint, error: runtime.lastError }
}

export async function ensureManagedLlamaCppRunning(): Promise<string> {
  if (!managedLlamaCppSupported()) throw new Error('Managed llama.cpp is only supported on macOS')
  if (!(await bundledLlamaCppAvailable())) throw new Error(missingBundledLlamaCppMessage())
  if (!(await managedLanguageModelAvailable())) throw new Error('Managed llama.cpp model is missing. Run Local AI setup to download it.')
  if (await managedLlamaCppReadiness()) return runtime.endpoint
  if (!runtime.startPromise) runtime.startPromise = startManagedLlamaCpp()
  try { await runtime.startPromise; return runtime.endpoint } finally { runtime.startPromise = null }
}

export async function stopManagedLlamaCpp(): Promise<void> {
  const child = runtime.process
  if (!child) return
  child.kill('SIGTERM')
  await waitForExit(child)
  if (runtime.process === child) resetProcess()
}

async function startManagedLlamaCpp(): Promise<void> {
  const binaryPath = resolveBundledLlamaCppBinary()
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await launchManagedLlamaCpp(binaryPath, await choosePort()); return } catch (error) {
      lastError = error
      await stopManagedLlamaCpp()
      if (!isPortBindError(error)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Managed llama.cpp could not find an available local port.')
}

async function launchManagedLlamaCpp(binaryPath: string, port: number): Promise<void> {
  const endpoint = endpointFor(port)
  const child = spawn(binaryPath, serverArgs(port), { env: runtimeEnv(binaryPath), stdio: ['ignore', 'ignore', 'pipe'] })
  runtime.process = child
  runtime.endpoint = endpoint
  runtime.ownedBySession = false
  wireEvents(child, binaryPath)
  await waitForLlamaCpp(child, binaryPath, port, endpoint)
  runtime.lastError = undefined
}

function serverArgs(port: number): string[] {
  return ['--model', managedLanguageModelPath(), '--alias', MANAGED_LLAMACPP_MODEL, '--host', MANAGED_LLAMACPP_HOST, '--port', String(port), '--no-webui', '--ctx-size', '32768', '--gpu-layers', '999', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--jinja']
}

function runtimeEnv(binaryPath: string): NodeJS.ProcessEnv {
  return childEnv({ DYLD_LIBRARY_PATH: [path.dirname(binaryPath), process.env.DYLD_LIBRARY_PATH || ''].filter(Boolean).join(':') })
}

function wireEvents(child: ReturnType<typeof spawn>, binaryPath: string): void {
  child.stderr?.on('data', (chunk) => { if (runtime.process === child) runtime.lastError = toLocalAISetupErrorState(lastLines(chunk.toString()), 'error', 'Managed llama.cpp reported an error') })
  child.on('exit', (code, signal) => { if (runtime.process !== child) return; resetProcess(); if (signal !== 'SIGTERM') runtime.lastError = toLocalAISetupErrorState(startupExitMessage(binaryPath, code, signal), 'error', 'Managed llama.cpp exited before becoming ready') })
  child.on('error', (error) => { if (runtime.process !== child) return; resetProcess(); runtime.lastError = toLocalAISetupErrorState(`Failed to start managed llama.cpp at ${binaryPath}: ${error.message}`, 'error', 'Failed to start managed llama.cpp') })
}

function resetProcess(): void { runtime.ownedBySession = false; runtime.process = null }
function bundledLlamaCppAvailable(): Promise<boolean> { return isExecutableFile(resolveBundledLlamaCppBinary()) }
async function managedLlamaCppReadiness(): Promise<boolean> { return runtime.ownedBySession && await managedLlamaCppOwnedAndHealthy(runtime.process) }

async function managedLlamaCppOwnedAndHealthy(child: ReturnType<typeof spawn> | null): Promise<boolean> {
  const port = endpointPort(runtime.endpoint)
  if (!(await childOwnsListener(child, port))) return false
  if (!(await healthy(runtime.endpoint))) return false
  return childOwnsListener(child, port)
}

async function waitForLlamaCpp(child: ReturnType<typeof spawn>, binaryPath: string, port: number, endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const startupError = earlyExit(child, binaryPath)
    if (startupError) throw new Error(startupError)
    if (await spawnedReady(child, port, endpoint)) { runtime.ownedBySession = true; return }
    if ((await listenerPid(port)) !== null && !(await childOwnsListener(child, port))) throw portBindError(port)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Managed llama.cpp did not become ready in time at ${binaryPath}${runtime.lastError?.error ? `: ${runtime.lastError.error}` : ''}`)
}

async function spawnedReady(child: ReturnType<typeof spawn>, port: number, endpoint: string): Promise<boolean> {
  if (!(await childOwnsListener(child, port))) return false
  if (!(await healthy(endpoint))) return false
  return childOwnsListener(child, port)
}

async function healthy(endpoint: string): Promise<boolean> { try { const response = await fetch(`${endpoint}/v1/models`); return response.ok } catch { return false } }
function earlyExit(child: ReturnType<typeof spawn>, binaryPath: string): string | null { return child.exitCode === null && child.signalCode === null ? null : runtime.lastError?.error || startupExitMessage(binaryPath, child.exitCode, child.signalCode) }
function startupExitMessage(binaryPath: string, code: number | null, signal: NodeJS.Signals | null): string { const status = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`; return `Managed llama.cpp exited before becoming ready from ${binaryPath} (${status})${runtime.lastError?.error ? `: ${runtime.lastError.error}` : ''}` }
function endpointFor(port: number): string { return `http://${MANAGED_LLAMACPP_HOST}:${port}` }
function endpointPort(endpoint: string): number { return Number(new URL(endpoint).port) }

async function choosePort(): Promise<number> {
  if (await portAvailable(MANAGED_LLAMACPP_PORT)) return MANAGED_LLAMACPP_PORT
  return freeLocalPort()
}

function portAvailable(port: number): Promise<boolean> { return probeLocalPort(port).then((server) => closeLocalServer(server).then(() => true), () => false) }
async function freeLocalPort(): Promise<number> { const server = await probeLocalPort(0); const address = server.address(); await closeLocalServer(server); if (!address || typeof address === 'string') throw new Error('Failed to reserve a local port for managed llama.cpp.'); return address.port }
function probeLocalPort(port: number): Promise<net.Server> { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, MANAGED_LLAMACPP_HOST, () => resolve(server)) }) }
function closeLocalServer(server: net.Server): Promise<void> { return new Promise((resolve) => server.close(() => resolve())) }
function portBindError(port: number): Error { return new Error(`Managed llama.cpp local port ${port} is already in use.`) }
function isPortBindError(error: unknown): boolean { return error instanceof Error && /port .*in use|address already in use|EADDRINUSE/i.test(error.message) }
function processRunning(child: ReturnType<typeof spawn> | null): child is ReturnType<typeof spawn> & { pid: number } { return Boolean(child?.pid && !child.killed && child.exitCode === null && child.signalCode === null) }
async function childOwnsListener(child: ReturnType<typeof spawn> | null, port: number): Promise<boolean> { return processRunning(child) && (await listenerPid(port)) === child.pid }

async function listenerPid(port: number): Promise<number | null> {
  try { const stdout = await new Promise<string>((resolve, reject) => execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (error, out) => error ? reject(error) : resolve(out))); const pid = Number.parseInt(stdout.trim().split('\n')[0] || '', 10); return Number.isInteger(pid) ? pid : null } catch { return null }
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (childExited(child)) return resolve()
    const timer = setTimeout(() => { if (!childExited(child)) child.kill('SIGKILL') }, SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function childExited(child: ReturnType<typeof spawn>): boolean { return child.exitCode !== null || child.signalCode !== null }
export function missingBundledLlamaCppMessage(): string { return app.isPackaged ? 'Bundled llama.cpp runtime files are missing from this app. Reinstall Gappd.' : `Bundled llama.cpp binary missing at ${resolveBundledLlamaCppBinary()}. Run \`npm run prepare:llamacpp\` before launching the desktop app.` }
