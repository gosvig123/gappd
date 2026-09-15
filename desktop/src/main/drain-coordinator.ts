import type { ManagedRuntimeCapability, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime'
import { recognizePendingSpeakers } from './speaker-recognition'
import { usingSummaryRuntime } from './summary-runtime'

const CAPABILITIES: ManagedRuntimeCapability[] = ['transcription', 'diarization', 'summarization']
const DRAIN_RETRY_INTERVAL_MS = 60_000
export type DrainPauseReason = 'recording' | 'sleep'
type Flight = { capability: ManagedRuntimeCapability; controller: AbortController; done?: Promise<void> }
const pending = new Set<ManagedRuntimeCapability>()
const observers = new Set<() => void>()
const pauseCounts = new Map<DrainPauseReason, number>()
let flight: Flight | null = null
let pendingCheckRunning = false
let retryTimer: NodeJS.Timeout | null = null
let stopObserving: (() => void) | null = null
let readinessKey = ''
let stopped = true

/**
 * Registers a listener for Meetings whose processing just finished. It is notified once per drain
 * that completed work, so a finished record can be picked up without polling.
 */
export function onMeetingProcessingFinished(observer: () => void): void {
  observers.add(observer)
}

export function startDrainCoordinator(): void {
  if (stopObserving) return
  stopped = false
  pauseCounts.clear()
  stopObserving = managedRuntime.observe(requestReadinessChange)
  retryTimer = setInterval(() => void requestPendingDrains(), DRAIN_RETRY_INTERVAL_MS)
  requestReadinessChange(managedRuntime.status())
}

export async function stopDrainCoordinator(): Promise<void> {
  stopped = true
  stopObserving?.()
  stopObserving = null
  if (retryTimer) clearInterval(retryTimer)
  retryTimer = null
  readinessKey = ''
  pending.clear()
  pauseCounts.clear()
  const current = flight
  current?.controller.abort()
  await current?.done
}

export async function pauseDrains(reason: DrainPauseReason): Promise<void> {
  pauseCounts.set(reason, (pauseCounts.get(reason) ?? 0) + 1)
  const current = flight
  if (!current) return
  pending.add(current.capability)
  current.controller.abort()
  await current.done
}

export function resumeDrains(reason: DrainPauseReason): void {
  const remaining = (pauseCounts.get(reason) ?? 0) - 1
  if (remaining > 0) pauseCounts.set(reason, remaining)
  else pauseCounts.delete(reason)
  startNextFlight()
}

export function requestDrains(): void {
  if (!stopped) requestReadyDrains(managedRuntime.status())
}

function requestReadinessChange(snapshot: ManagedRuntimeSnapshot): void {
  const next = CAPABILITIES.map((name) => snapshot.capabilities[name].readiness).join(':')
  if (next === readinessKey) return
  readinessKey = next
  void requestPendingDrains()
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

export async function requestPendingDrains(): Promise<void> {
  if (stopped || pendingCheckRunning) return
  pendingCheckRunning = true
  try {
    await recognizePendingSpeakers(AbortSignal.timeout(60_000))
    const result = await requestCommand('processing.pending', {})
    const snapshot = managedRuntime.status()
    for (const capability of result.capabilities) {
      if (capability === 'diarization' || snapshot.capabilities[capability].readiness === 'ready') requestDrain(capability)
    }
  } catch (error) {
    console.error('pending processing check failed', error)
  } finally {
    pendingCheckRunning = false
  }
}

function startNextFlight(): void {
  if (stopped || pauseCounts.size || flight) return
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
    if (result.completed > 0) for (const observer of observers) observer()
    if (current.capability === 'transcription' && result.completed > 0) requestDrain('diarization')
    if (current.capability === 'diarization' && result.completed + result.failed > 0) requestDrain('summarization')
  } catch (error) {
    if (!current.controller.signal.aborted) console.error(`${current.capability} drain failed`, error)
  } finally {
    if (flight === current) flight = null
    startNextFlight()
  }
}

async function drainCapability(current: Flight) {
  if (current.capability === 'summarization') await recognizePendingSpeakers(current.controller.signal)
  const drain = (env: NodeJS.ProcessEnv) => requestCommand('processing.drain', { capability: current.capability }, env, current.controller.signal)
  if (current.capability === 'summarization') return usingSummaryRuntime(drain)
  const capabilities = current.capability === 'diarization' ? [] : [current.capability]
  return managedRuntime.using(capabilities, () => drain({}))
}
