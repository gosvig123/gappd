import type { ManagedRuntimeCapability, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime'

const CAPABILITIES: ManagedRuntimeCapability[] = ['transcription', 'summarization']
type Flight = { running: boolean; rerun: boolean; controller?: AbortController; done?: Promise<void> }
const flights = new Map<ManagedRuntimeCapability, Flight>()
let stopObserving: (() => void) | null = null
let readinessKey = ''
let stopped = true

export function startDrainCoordinator(): void {
  if (stopObserving) return
  stopped = false
  stopObserving = managedRuntime.observe(requestReadinessChange)
  requestReadinessChange(managedRuntime.status())
}

export async function stopDrainCoordinator(): Promise<void> {
  stopped = true
  stopObserving?.()
  stopObserving = null
  readinessKey = ''
  for (const flight of flights.values()) flight.controller?.abort()
  await Promise.all([...flights.values()].map((flight) => flight.done).filter(Boolean))
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
    if (snapshot.capabilities[capability].readiness === 'ready') requestDrain(capability)
  }
}

function requestDrain(capability: ManagedRuntimeCapability): void {
  if (stopped) return
  const flight = flights.get(capability) ?? { running: false, rerun: false }
  flights.set(capability, flight)
  if (flight.running) { flight.rerun = true; return }
  startFlight(capability, flight)
}

function startFlight(capability: ManagedRuntimeCapability, flight: Flight): void {
  flight.running = true
  flight.controller = new AbortController()
  flight.done = runDrain(capability, flight, flight.controller.signal)
}

async function runDrain(capability: ManagedRuntimeCapability, flight: Flight, signal: AbortSignal): Promise<void> {
  try {
    const result = await managedRuntime.using([capability], () => requestCommand('processing.drain', { capability }, {}, signal))
    if (capability === 'transcription' && result.completed > 0) requestDrain('summarization')
  } catch (error) {
    if (!signal.aborted) console.error(`${capability} drain failed`, error)
  } finally {
    finishFlight(capability, flight)
  }
}

function finishFlight(capability: ManagedRuntimeCapability, flight: Flight): void {
  flight.running = false
  flight.controller = undefined
  flight.done = undefined
  if (flight.rerun && !stopped) { flight.rerun = false; requestDrain(capability) }
}
