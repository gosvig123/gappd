import type { ManagedRuntimeCapability, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime'
import { PiConfigurationError } from './pi-runtime'
import { usingSummaryRuntime } from './summary-runtime'

const CAPABILITIES: ManagedRuntimeCapability[] = ['transcription', 'diarization', 'summarization']
type Flight = { capability: ManagedRuntimeCapability; controller: AbortController; done?: Promise<void> }
const pending = new Set<ManagedRuntimeCapability>()
let flight: Flight | null = null
let stopObserving: (() => void) | null = null
let readinessKey = ''
let pauses = 0
let stopped = true

export function startDrainCoordinator(): void {
  if (stopObserving) return
  stopped = false
  pauses = 0
  stopObserving = managedRuntime.observe(requestReadinessChange)
  requestReadinessChange(managedRuntime.status())
}

export async function stopDrainCoordinator(): Promise<void> {
  stopped = true
  stopObserving?.()
  stopObserving = null
  readinessKey = ''
  pending.clear()
  const current = flight
  current?.controller.abort()
  await current?.done
}

export async function pauseDrains(): Promise<void> {
  pauses += 1
  const current = flight
  if (!current) return
  pending.add(current.capability)
  current.controller.abort()
  await current.done
}

export function resumeDrains(): void {
  pauses = Math.max(0, pauses - 1)
  startNextFlight()
}

export function requestDrains(): void {
  if (!stopped) requestReadyDrains(managedRuntime.status())
}

function requestReadinessChange(snapshot: ManagedRuntimeSnapshot): void {
  const next = CAPABILITIES.map((name) => snapshot.capabilities[name].readiness).join(':')
  if (next === readinessKey) return
  readinessKey = next
  requestReadyDrains(snapshot)
}

function requestReadyDrains(snapshot: ManagedRuntimeSnapshot): void {
  for (const capability of CAPABILITIES) {
    if (capability === 'diarization' || snapshot.capabilities[capability].readiness === 'ready') requestDrain(capability)
  }
}

function requestDrain(capability: ManagedRuntimeCapability): void {
  if (stopped) return
  pending.add(capability)
  startNextFlight()
}

function startNextFlight(): void {
  if (stopped || pauses || flight) return
  const capability = CAPABILITIES.find((candidate) => pending.has(candidate))
  if (!capability) return
  pending.delete(capability)
  const next: Flight = { capability, controller: new AbortController() }
  flight = next
  next.done = runDrain(next)
}

async function runDrain(current: Flight): Promise<void> {
  try {
    const result = await drainCapability(current)
    if (current.capability === 'transcription' && result.completed > 0) requestDrain('diarization')
    if (current.capability === 'diarization' && result.completed + result.failed > 0) requestDrain('summarization')
  } catch (error) {
    if (!current.controller.signal.aborted && !(error instanceof PiConfigurationError)) console.error(`${current.capability} drain failed`, error)
  } finally {
    if (flight === current) flight = null
    startNextFlight()
  }
}

function drainCapability(current: Flight) {
  const drain = (env: NodeJS.ProcessEnv) => requestCommand('processing.drain', { capability: current.capability }, env, current.controller.signal)
  if (current.capability === 'summarization') return usingSummaryRuntime(drain)
  const capabilities = current.capability === 'diarization' ? [] : [current.capability]
  return managedRuntime.using(capabilities, () => drain({}))
}
