import { execFile, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { app } from 'electron'
import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus } from '../shared/contracts'
import { BUNDLED_OLLAMA_BINARY_NAME, BUNDLED_OLLAMA_CACHE_DIRNAME, BUNDLED_OLLAMA_CACHE_ROOT_DIRNAME, BUNDLED_OLLAMA_RELEASE, MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_HOST, MANAGED_OLLAMA_MODEL, MANAGED_OLLAMA_MODELS_DIRNAME, MANAGED_OLLAMA_PORT } from '../shared/bundled-ollama'
import { lastLines } from '../shared/subprocess-output'
import { isExecutableFile, resolveBinary } from './binaries'
import { childEnv } from './native-runtime'
import { type OnboardingErrorState, toOnboardingErrorState } from './onboarding-errors'
import { pullModelFromOllamaApi, type PullProgressUpdate } from './ollama-pull'

type ManagedOllamaRuntime = {
  process: ReturnType<typeof spawn> | null
  startPromise: Promise<void> | null
  ownedBySession: boolean
  endpoint: string
  lastError?: OnboardingErrorState
}

const managedOllama: ManagedOllamaRuntime = { process: null, startPromise: null, ownedBySession: false, endpoint: MANAGED_OLLAMA_ENDPOINT }

type ManagedStatusContext = { config: LocalAIConfig | null; configError?: string; supported: boolean; bundled: boolean; running: boolean; configured: boolean; modelAvailable: boolean }
type ManagedReadiness = { running: boolean }

const OLLAMA_SHUTDOWN_TIMEOUT_MS = 5_000

export function resolveBundledOllamaBinary(): string {
  return resolveBinary({
    packaged: ['ollama', BUNDLED_OLLAMA_BINARY_NAME],
    dev: [BUNDLED_OLLAMA_CACHE_DIRNAME, BUNDLED_OLLAMA_CACHE_ROOT_DIRNAME, BUNDLED_OLLAMA_RELEASE, BUNDLED_OLLAMA_BINARY_NAME],
  })
}
export function managedOllamaSupported(): boolean { return process.platform === 'darwin' }
export function managedOllamaEndpoint(): string { return managedOllama.endpoint }
export async function getManagedOllamaStatus(config: LocalAIConfig | null, configError?: string): Promise<LocalAIStatus> {
  const supported = managedOllamaSupported()
  const bundled = supported ? await bundledOllamaAvailable() : false
  const readiness = bundled ? await managedOllamaReadiness() : { running: false }
  const configured = isManagedLocalAIConfigured(config)
  const modelAvailable = configured && readiness.running && config ? await managedModelAvailable(config.model) : false
  return buildLocalAIStatus({ config, configError, supported, bundled, running: readiness.running, configured, modelAvailable })
}
export async function ensureManagedOllamaRunning(): Promise<string> {
  if (!managedOllamaSupported()) throw new Error('Managed Ollama is only supported on macOS')
  if (!(await bundledOllamaAvailable())) throw new Error(`Bundled Ollama binary missing at ${resolveBundledOllamaBinary()}. Run \`npm run prepare:ollama\` before launching the desktop app.`)
  const readiness = await managedOllamaReadiness()
  if (readiness.running) return managedOllama.endpoint
  if (!managedOllama.startPromise) managedOllama.startPromise = startManagedOllama()
  try {
    await managedOllama.startPromise
    return managedOllama.endpoint
  } finally {
    managedOllama.startPromise = null
  }
}
export async function pullManagedModel(model: string, onProgress?: (update: PullProgressUpdate) => void, endpoint?: string): Promise<void> {
  const pullEndpoint = endpoint ?? await ensureManagedOllamaRunning()
  try {
    await pullModelFromOllamaApi(pullEndpoint, model, onProgress)
    managedOllama.lastError = undefined
  } catch (error) {
    managedOllama.lastError = toOnboardingErrorState(error, 'pulling_model', 'Managed Ollama model pull failed')
    throw error
  }
}
export async function managedModelAvailable(model: string, endpoint = managedOllama.endpoint): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/api/tags`)
    if (!response.ok) return false
    const body = (await response.json()) as unknown
    return taggedModelNames(body).includes(model)
  } catch {
    return false
  }
}
export async function stopManagedOllama(): Promise<void> {
  const child = managedOllama.process
  if (!child) return
  child.kill('SIGTERM')
  await waitForManagedOllamaExit(child)
  if (managedOllama.process === child) resetManagedOllamaProcess()
}

async function startManagedOllama(): Promise<void> {
  await mkdir(managedOllamaModelsDir(), { recursive: true })
  const binaryPath = resolveBundledOllamaBinary()
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await launchManagedOllama(binaryPath, await chooseManagedOllamaPort())
      return
    } catch (error) {
      lastError = error
      await stopManagedOllama()
      if (!isPortBindError(error)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Managed Ollama could not find an available local port.')
}

async function launchManagedOllama(binaryPath: string, port: number): Promise<void> {
  const endpoint = managedOllamaEndpointFor(port)
  const child = spawn(binaryPath, ['serve'], { env: managedOllamaEnv(endpoint), stdio: ['ignore', 'ignore', 'pipe'] })
  managedOllama.process = child
  managedOllama.endpoint = endpoint
  managedOllama.ownedBySession = false
  wireManagedOllamaEvents(child, binaryPath)
  await waitForManagedOllama(child, binaryPath, port, endpoint)
  managedOllama.lastError = undefined
}
function buildLocalAIStatus(context: ManagedStatusContext): LocalAIStatus {
  const phase = localAIPhase(context)
  const error = context.configError ? toOnboardingErrorState(context.configError, phase, 'Failed to read local AI configuration') : phase === 'error' ? managedOllama.lastError : undefined
  return {
    phase,
    managed: Boolean(context.config?.managed),
    endpoint: context.running ? managedOllama.endpoint : context.config?.endpoint || MANAGED_OLLAMA_ENDPOINT,
    model: context.config?.model || MANAGED_OLLAMA_MODEL,
    message: localAIMessage(context),
    error: error?.error,
    errorDetail: error?.errorDetail,
    debugDetail: error?.debugDetail,
    errorDebug: error?.errorDebug,
    errorKind: error?.errorKind,
    ownershipConflict: error?.ownershipConflict,
    canRetry: phase === 'error' || (context.configured && context.running && !context.modelAvailable),
    supported: context.supported,
    configured: context.configured,
    bundled: context.bundled,
    running: context.running,
    canRepair: context.supported && context.bundled,
  }
}
function managedOllamaEnv(endpoint: string): NodeJS.ProcessEnv { return { ...childEnv(), OLLAMA_HOST: managedOllamaHostValue(endpoint), OLLAMA_MODELS: managedOllamaModelsDir() } }
function wireManagedOllamaEvents(child: ReturnType<typeof spawn>, binaryPath: string): void {
  child.stderr?.on('data', (chunk) => {
    if (managedOllama.process !== child) return
    managedOllama.lastError = toOnboardingErrorState(lastLines(chunk.toString()), 'error', 'Managed Ollama reported an error')
  })
  child.on('exit', (code, signal) => {
    if (managedOllama.process !== child) return
    resetManagedOllamaProcess()
    if (signal !== 'SIGTERM') managedOllama.lastError = toOnboardingErrorState(startupExitMessage(binaryPath, code, signal), 'error', 'Managed Ollama exited before becoming ready')
  })
  child.on('error', (error) => {
    if (managedOllama.process !== child) return
    resetManagedOllamaProcess()
    managedOllama.lastError = toOnboardingErrorState(`Failed to start managed Ollama at ${binaryPath}: ${error.message}`, 'error', 'Failed to start managed Ollama')
  })
}
function resetManagedOllamaProcess(): void {
  managedOllama.ownedBySession = false
  managedOllama.process = null
}

function waitForManagedOllamaExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (childExited(child)) return resolve()
    const timer = setTimeout(() => { if (!childExited(child)) child.kill('SIGKILL') }, OLLAMA_SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function childExited(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode !== null || child.signalCode !== null
}
function managedOllamaProcessRunning(child: ReturnType<typeof spawn> | null): child is ReturnType<typeof spawn> & { pid: number } { return Boolean(child?.pid && !child.killed && child.exitCode === null && child.signalCode === null) }
async function managedOllamaListenerPid(port: number): Promise<number | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (error, out) => error ? reject(error) : resolve(out)))
    const pid = Number.parseInt(stdout.trim().split('\n')[0] || '', 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}
async function managedOllamaChildOwnsListener(child: ReturnType<typeof spawn> | null, port: number): Promise<boolean> { return managedOllamaProcessRunning(child) && (await managedOllamaListenerPid(port)) === child.pid }
async function managedOllamaOwnedAndHealthy(child: ReturnType<typeof spawn> | null): Promise<boolean> {
  const port = managedOllamaPort(managedOllama.endpoint)
  if (!(await managedOllamaChildOwnsListener(child, port))) return false
  if (!(await managedOllamaHealthy(managedOllama.endpoint))) return false
  return managedOllamaChildOwnsListener(child, port)
}
async function managedOllamaReadiness(): Promise<ManagedReadiness> {
  const running = managedOllama.ownedBySession && await managedOllamaOwnedAndHealthy(managedOllama.process)
  return { running }
}
function taggedModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('models' in payload) || !Array.isArray(payload.models)) return []
  return payload.models.flatMap((model) => (!model || typeof model !== 'object' ? [] : [model.name, model.model].filter((value): value is string => typeof value === 'string')))
}
function managedOllamaModelsDir(): string { return path.join(app.getPath('userData'), MANAGED_OLLAMA_MODELS_DIRNAME) }
function managedOllamaEndpointFor(port: number): string { return `http://${MANAGED_OLLAMA_HOST}:${port}` }
function managedOllamaHostValue(endpoint: string): string { return new URL(endpoint).host }
function managedOllamaPort(endpoint: string): number { return Number(new URL(endpoint).port) }
async function bundledOllamaAvailable(): Promise<boolean> { return isExecutableFile(resolveBundledOllamaBinary()) }
async function managedOllamaHealthy(endpoint: string): Promise<boolean> { try { const response = await fetch(`${endpoint}/api/version`); return response.ok } catch { return false } }
async function waitForManagedOllama(child: ReturnType<typeof spawn>, binaryPath: string, port: number, endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const startupError = earlyManagedOllamaExit(child, binaryPath)
    if (startupError) throw new Error(startupError)
    if (await spawnedOllamaReady(child, port, endpoint)) {
      managedOllama.ownedBySession = true
      return
    }
    if ((await managedOllamaListenerPid(port)) !== null && !(await managedOllamaChildOwnsListener(child, port))) throw portBindError(port)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Managed Ollama did not become ready in time at ${binaryPath}${managedOllama.lastError?.error ? `: ${managedOllama.lastError.error}` : ''}`)
}
function earlyManagedOllamaExit(child: ReturnType<typeof spawn>, binaryPath: string): string | null {
  if (child.exitCode === null && child.signalCode === null) return null
  return managedOllama.lastError?.error || startupExitMessage(binaryPath, child.exitCode, child.signalCode)
}
async function spawnedOllamaReady(child: ReturnType<typeof spawn>, port: number, endpoint: string): Promise<boolean> {
  if (!(await managedOllamaChildOwnsListener(child, port))) return false
  if (!(await managedOllamaHealthy(endpoint))) return false
  return managedOllamaChildOwnsListener(child, port)
}
function startupExitMessage(binaryPath: string, code: number | null, signal: NodeJS.Signals | null): string {
  const status = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
  return `Managed Ollama exited before becoming ready from ${binaryPath} (${status})${managedOllama.lastError?.error ? `: ${managedOllama.lastError.error}` : ''}`
}
async function chooseManagedOllamaPort(): Promise<number> {
  if (await portAvailable(MANAGED_OLLAMA_PORT)) return MANAGED_OLLAMA_PORT
  return freeLocalPort()
}
function portAvailable(port: number): Promise<boolean> {
  return probeLocalPort(port).then((server) => closeLocalServer(server).then(() => true), () => false)
}
async function freeLocalPort(): Promise<number> {
  const server = await probeLocalPort(0)
  const address = server.address()
  await closeLocalServer(server)
  if (!address || typeof address === 'string') throw new Error('Failed to reserve a local port for managed Ollama.')
  return address.port
}
function probeLocalPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, MANAGED_OLLAMA_HOST, () => resolve(server))
  })
}
function closeLocalServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
function portBindError(port: number): Error { return new Error(`Managed Ollama local port ${port} is already in use.`) }
function isPortBindError(error: unknown): boolean { return error instanceof Error && /port .*in use|address already in use|EADDRINUSE/i.test(error.message) }
function localAIMessage(context: ManagedStatusContext): string {
  if (context.configError) return 'Failed to read local AI configuration'
  if (!context.supported) return 'Managed Ollama is unavailable on this platform'
  if (!context.bundled) return 'Bundled Ollama runtime is missing. Run `npm run prepare:ollama` before launching the desktop app.'
  if (context.configured && context.running && !context.modelAvailable) return `Managed Ollama is running, but model ${context.config?.model || MANAGED_OLLAMA_MODEL} is missing. Run setup to pull it again.`
  if (context.configured && context.running) return 'Managed Ollama is running'
  if (context.configured) return 'Managed Ollama is configured but stopped'
  if (context.config && !context.config.managed) return context.running ? 'Gappd is configured for external Ollama while the managed runtime is running. Run setup to switch to the managed runtime.' : 'Gappd is configured for external Ollama. Run setup to switch to the managed runtime.'
  if (context.running) return 'Managed Ollama is running but setup has not switched Gappd to it yet.'
  return 'Managed Ollama is ready for setup'
}
function localAIPhase(context: ManagedStatusContext): LocalAIStatus['phase'] {
  if (context.configError || !context.supported || !context.bundled) return 'error'
  if (context.configured && context.running && !context.modelAvailable) return 'needs_setup'
  if (context.configured && context.running) return 'ready'
  if (context.configured) return 'error'
  return 'needs_setup'
}
