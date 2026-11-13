import type { ManagedRuntimeCapability, ManagedRuntimeSnapshot } from '../shared/managed-runtime'
import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime/runtime'
import { recognizePendingSpeakers } from './speaker-recognition'
import { usingSummaryRuntime } from './summary-runtime'
import { logFailure, reportFailure } from './error-log'

const CAPABILITIES: ManagedRuntimeCapability[] = ['transcription', 'diarization', 'summarization']
// Speaker recognition is a step between speaker detection and notes, so names are filled before
// notes and it never runs beside another step's backend writes. It runs when something that can
// change a Meeting's speaker names changed (launch, speaker detection, a user edit, a deleted
// Meeting) and before notes work, which covers a Meeting a pass skipped while it was claimed. A
// pass with a failed Meeting repeats on the retry interval.
type DrainStep = ManagedRuntimeCapability | 'speakers'
const STEPS: DrainStep[] = ['transcription', 'diarization', 'speakers', 'summarization']
const DRAIN_RETRY_INTERVAL_MS = 60_000
// Transcription work waits while the Apple speech model is not ready. Only launch and the setup card
// download the model, so the retry check asks for it again, at most every 5 minutes. A wait longer
// than an hour is a processing.stalled Error report, sent at most every 10 minutes while it lasts.
const SPEECH_RETRY_INTERVAL_MS = 5 * 60_000
const TRANSCRIPTION_STALL_MS = 60 * 60_000
export type DrainPauseReason = 'recording' | 'sleep'
type Flight = { capability: DrainStep; controller: AbortController; done?: Promise<void> }
const pending = new Set<DrainStep>()
const observers = new Set<() => void>()
const pauseCounts = new Map<DrainPauseReason, number>()
let flight: Flight | null = null
let pendingCheckRunning = false
let retryTimer: NodeJS.Timeout | null = null
let stopObserving: (() => void) | null = null
let readinessKey = ''
let stopped = true
let speakersIncomplete = false
let transcriptionWaitSince: number | null = null
let nextSpeechRetryAt = 0
let stallLogged = false

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
  requestDrain('speakers')
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
  speakersIncomplete = false
  transcriptionWaitSince = null
  stallLogged = false
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
  if (stopped) return
  requestDrain('speakers')
  requestReadyDrains(managedRuntime.status())
}

/** For changes that can rename speakers in other Meetings without other processing work. */
export function requestSpeakerRecognition(): void {
  requestDrain('speakers')
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

function requestDrain(capability: DrainStep): void {
  if (stopped) return
  if (capability === 'summarization' && flight?.capability !== 'speakers') pending.add('speakers')
  pending.add(capability)
  startNextFlight()
}

export async function requestPendingDrains(): Promise<void> {
  if (stopped || pendingCheckRunning) return
  pendingCheckRunning = true
  try {
    if (speakersIncomplete && flight?.capability !== 'speakers') requestDrain('speakers')
    const result = await requestCommand('processing.pending', {})
    const snapshot = managedRuntime.status()
    for (const capability of result.capabilities) {
      if (capability === 'diarization' || snapshot.capabilities[capability].readiness === 'ready') requestDrain(capability)
    }
    noteTranscriptionWait(result.capabilities.includes('transcription') && snapshot.capabilities.transcription.readiness !== 'ready')
  } catch (error) {
    logFailure('processing.pending-check', 'pending processing check failed', error)
  } finally {
    pendingCheckRunning = false
  }
}

function noteTranscriptionWait(waiting: boolean): void {
  if (stopped) return
  if (!waiting) {
    transcriptionWaitSince = null
    stallLogged = false
    return
  }
  const now = Date.now()
  if (now >= nextSpeechRetryAt) {
    nextSpeechRetryAt = now + SPEECH_RETRY_INTERVAL_MS
    void managedRuntime.prepare('speech').catch(() => undefined)
  }
  transcriptionWaitSince ??= now
  if (now - transcriptionWaitSince < TRANSCRIPTION_STALL_MS) return
  const error = new Error('Transcription has waited more than an hour for the Apple speech model')
  if (stallLogged) return reportFailure('processing.stalled', error)
  stallLogged = true
  logFailure('processing.stalled', error.message, error)
}

function startNextFlight(): void {
  if (stopped || pauseCounts.size || flight) return
  const capability = STEPS.find((candidate) => pending.has(candidate))
  if (!capability) return
  pending.delete(capability)
  const next: Flight = { capability, controller: new AbortController() }
  flight = next
  next.done = runDrain(next)
}

async function runDrain(current: Flight): Promise<void> {
  try {
    if (current.capability === 'speakers') return await recognizeSpeakers(current.controller.signal)
    const result = await drainCapability(current, current.capability)
    if (result.completed > 0) for (const observer of observers) observer()
    if (current.capability === 'transcription' && result.completed > 0) requestDrain('diarization')
    if (current.capability === 'diarization' && result.completed > 0) requestDrain('speakers')
    if (current.capability === 'diarization' && result.completed + result.failed > 0) requestDrain('summarization')
  } catch (error) {
    // A failed or paused speaker detection drain can have finished Meetings before it stopped.
    if (current.capability === 'diarization') requestDrain('speakers')
    // A capability can stop being ready between the pending check and the drain. The next check waits for it.
    if (isNotReady(error)) console.warn(`${current.capability} drain waits: ${error.message}`)
    else if (!current.controller.signal.aborted) logFailure('processing.drain', `${current.capability} drain failed`, error)
  } finally {
    if (flight === current) flight = null
    startNextFlight()
  }
}

function isNotReady(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'CAPABILITY_NOT_READY'
}

async function recognizeSpeakers(signal: AbortSignal): Promise<void> {
  try {
    speakersIncomplete = !(await recognizePendingSpeakers(signal))
  } catch (error) {
    // A paused pass is queued again; a failed one repeats on the retry interval.
    speakersIncomplete = !signal.aborted
    throw error
  }
}

async function drainCapability(current: Flight, capability: ManagedRuntimeCapability) {
  const drain = (env: NodeJS.ProcessEnv) => requestCommand('processing.drain', { capability }, env, current.controller.signal)
  if (capability === 'summarization') return usingSummaryRuntime(drain)
  const capabilities = capability === 'diarization' ? [] : [capability]
  return managedRuntime.using(capabilities, () => drain({}))
}
