import path from 'node:path'
import { app } from 'electron'
import { BUNDLED_LLAMACPP_BINARY_NAME, MANAGED_LLAMACPP_ENDPOINT, MANAGED_LLAMACPP_HOST, MANAGED_LLAMACPP_MODEL } from '../shared/managed-local-ai'
import { lastLines } from '../shared/subprocess-output'
import { isExecutableFile, resolveBinary } from './binaries'
import { childEnv } from './native-runtime'
import { managedLanguageModelAvailable, managedLanguageModelPath } from './language-model'
import { type ManagedRuntimeErrorState, toManagedRuntimeErrorState } from './managed-runtime-errors'
import { chooseLlamaCppPort, isLlamaCppPortBindError, processServesEndpoint, reclaimStaleLlamaCppProcess, spawnLlamaCpp, stopLlamaCppProcess, waitForLlamaCppReadiness, type LlamaCppChild } from './llamacpp-process'

type LlamaCppRuntime = { process: LlamaCppChild | null; startPromise: Promise<void> | null; stopPromise: Promise<void> | null; ownedBySession: boolean; endpoint: string; lastError?: ManagedRuntimeErrorState }
type ModelListResponse = { models?: Array<{ name?: string; model?: string }> }
export type ManagedLlamaCppLease = { endpoint: string; release(): Promise<void> }
export type ManagedLlamaCppRuntimeStatus = { supported: boolean; bundled: boolean; running: boolean; endpoint: string; error?: ManagedRuntimeErrorState }

const MODEL_CHECK_TIMEOUT_MS = 2_000
const runtime: LlamaCppRuntime = { process: null, startPromise: null, stopPromise: null, ownedBySession: false, endpoint: MANAGED_LLAMACPP_ENDPOINT }
let runtimeUsers = 0

export function resolveBundledLlamaCppBinary(): string {
  return resolveBinary({ packaged: ['llamacpp', BUNDLED_LLAMACPP_BINARY_NAME], dev: ['resources', 'llamacpp', BUNDLED_LLAMACPP_BINARY_NAME] })
}
export function managedLlamaCppSupported(): boolean { return process.platform === 'darwin' }
export function managedLlamaCppEndpoint(): string { return runtime.endpoint }

export async function getManagedLlamaCppRuntimeStatus(): Promise<ManagedLlamaCppRuntimeStatus> {
  const supported = managedLlamaCppSupported()
  const bundled = supported ? await managedLlamaCppAvailable() : false
  const running = bundled ? await managedLlamaCppReadiness() : false
  return { supported, bundled, running, endpoint: runtime.endpoint, error: runtime.lastError }
}

async function ensureManagedLlamaCppRunning(): Promise<string> {
  if (runtime.stopPromise) await runtime.stopPromise
  if (!managedLlamaCppSupported()) throw new Error('Managed llama.cpp is only supported on macOS')
  if (!(await managedLlamaCppAvailable())) throw new Error(missingBundledLlamaCppMessage())
  if (!(await managedLanguageModelAvailable())) throw new Error('Managed llama.cpp model is missing. Run Local AI setup to download it.')
  await reclaimStaleLlamaCppProcess(runtime.process, resolveBundledLlamaCppBinary(), endpointPort(runtime.endpoint))
  if (await managedLlamaCppReadiness()) return runtime.endpoint
  if (!runtime.startPromise) runtime.startPromise = startManagedLlamaCpp()
  try { await runtime.startPromise; return runtime.endpoint } finally { runtime.startPromise = null }
}

export async function acquireManagedLlamaCpp(): Promise<ManagedLlamaCppLease> {
  runtimeUsers += 1
  try {
    const endpoint = await ensureManagedLlamaCppRunning()
    return createLease(endpoint)
  } catch (error) {
    runtimeUsers -= 1
    throw error
  }
}

export async function stopManagedLlamaCpp(): Promise<void> {
  if (runtime.stopPromise) return runtime.stopPromise
  const child = runtime.process
  if (!child) return
  runtime.stopPromise = stopLlamaCppProcess(child).finally(() => {
    if (runtime.process === child) resetProcess()
    runtime.stopPromise = null
  })
  return runtime.stopPromise
}

function createLease(endpoint: string): ManagedLlamaCppLease {
  let released = false
  return { endpoint, release: async () => {
    if (released) return
    released = true
    runtimeUsers -= 1
    if (runtimeUsers === 0) await stopManagedLlamaCpp()
  } }
}

async function startManagedLlamaCpp(): Promise<void> {
  const binaryPath = resolveBundledLlamaCppBinary()
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await launchManagedLlamaCpp(binaryPath, await chooseLlamaCppPort()); return } catch (error) {
      lastError = error
      await stopManagedLlamaCpp()
      if (!isLlamaCppPortBindError(error)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Managed llama.cpp could not find an available local port.')
}

async function launchManagedLlamaCpp(binaryPath: string, port: number): Promise<void> {
  const endpoint = endpointFor(port)
  const child = spawnLlamaCpp(binaryPath, serverArgs(port), runtimeEnv(binaryPath))
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

function wireEvents(child: LlamaCppChild, binaryPath: string): void {
  child.stderr?.on('data', (chunk) => { if (runtime.process === child) runtime.lastError = toManagedRuntimeErrorState(lastLines(chunk.toString()), 'error', 'Managed llama.cpp reported an error') })
  child.on('exit', (code, signal) => { if (runtime.process !== child) return; resetProcess(); if (signal !== 'SIGTERM') runtime.lastError = toManagedRuntimeErrorState(startupExitMessage(binaryPath, code, signal), 'error', 'Managed llama.cpp exited before becoming ready') })
  child.on('error', (error) => { if (runtime.process !== child) return; resetProcess(); runtime.lastError = toManagedRuntimeErrorState(`Failed to start managed llama.cpp at ${binaryPath}: ${error.message}`, 'error', 'Failed to start managed llama.cpp') })
}

function resetProcess(): void { runtime.ownedBySession = false; runtime.process = null }
export function managedLlamaCppAvailable(): Promise<boolean> { return isExecutableFile(resolveBundledLlamaCppBinary()) }
async function managedLlamaCppReadiness(): Promise<boolean> {
  if (runtime.ownedBySession) return managedLlamaCppOwnedAndHealthy(runtime.process)
  if (await endpointServesManagedModel(runtime.endpoint)) return true
  return false
}

async function managedLlamaCppOwnedAndHealthy(child: LlamaCppChild | null): Promise<boolean> {
  return processServesEndpoint(child, endpointPort(runtime.endpoint), runtime.endpoint)
}

async function endpointServesManagedModel(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(MODEL_CHECK_TIMEOUT_MS) })
    if (!response.ok) return false
    return modelListContains(await response.json())
  } catch {
    return false
  }
}

function modelListContains(value: unknown): boolean {
  if (!isModelList(value)) return false
  return value.models.some((model) => model.name === MANAGED_LLAMACPP_MODEL || model.model === MANAGED_LLAMACPP_MODEL)
}

function isModelList(value: unknown): value is ModelListResponse & { models: NonNullable<ModelListResponse['models']> } {
  return typeof value === 'object' && value !== null && Array.isArray((value as ModelListResponse).models)
}

async function waitForLlamaCpp(child: LlamaCppChild, binaryPath: string, port: number, endpoint: string): Promise<void> {
  try {
    await waitForLlamaCppReadiness({ child, binaryPath, port, endpoint, startupError: () => earlyExit(child, binaryPath) })
    runtime.ownedBySession = true
  } catch (error) {
    if (isReadinessTimeout(error)) throw new Error(`${error.message}${runtime.lastError?.error ? `: ${runtime.lastError.error}` : ''}`)
    throw error
  }
}

function earlyExit(child: LlamaCppChild, binaryPath: string): string | null { return child.exitCode === null && child.signalCode === null ? null : runtime.lastError?.error || startupExitMessage(binaryPath, child.exitCode, child.signalCode) }
function startupExitMessage(binaryPath: string, code: number | null, signal: NodeJS.Signals | null): string { const status = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`; return `Managed llama.cpp exited before becoming ready from ${binaryPath} (${status})${runtime.lastError?.error ? `: ${runtime.lastError.error}` : ''}` }
function endpointFor(port: number): string { return `http://${MANAGED_LLAMACPP_HOST}:${port}` }
function endpointPort(endpoint: string): number { return Number(new URL(endpoint).port) }

function isReadinessTimeout(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('Managed llama.cpp did not become ready in time')
}

export function missingBundledLlamaCppMessage(): string { return app.isPackaged ? 'Bundled llama.cpp runtime files are missing from this app. Reinstall Gappd.' : `Bundled llama.cpp binary missing at ${resolveBundledLlamaCppBinary()}. Run \`npm run prepare:llamacpp\` before launching the desktop app.` }
