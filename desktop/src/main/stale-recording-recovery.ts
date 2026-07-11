import { requestCommand } from './app-protocol'
import { acquireManagedLocalAI } from './local-ai-config'

const STALE_RECORDING_RECOVERY_INTERVAL_MS = 60_000

let staleRecoveryTimer: NodeJS.Timeout | null = null
let staleRecoveryRunning = false

export async function startStaleRecordingRecovery(): Promise<number> {
  if (!staleRecoveryTimer) staleRecoveryTimer = setInterval(() => void runStaleRecordingRecovery(), STALE_RECORDING_RECOVERY_INTERVAL_MS)
  return runStaleRecordingRecovery()
}

export function stopStaleRecordingRecovery(): void {
  if (!staleRecoveryTimer) return
  clearInterval(staleRecoveryTimer)
  staleRecoveryTimer = null
}

async function recoverStaleRecordings(): Promise<number> {
  const stale = await requestCommand('record.hasStale', {})
  if (!stale.hasStale) return 0
  const lease = await acquireManagedLocalAI()
  try {
    const result = await requestCommand('record.recoverStale', {})
    return result.recovered
  } finally {
    await lease.release()
  }
}

async function runStaleRecordingRecovery(): Promise<number> {
  if (staleRecoveryRunning) return 0
  staleRecoveryRunning = true
  try {
    return await recoverStaleRecordings()
  } catch (error) {
    console.error('stale recording recovery failed', error)
    return 0
  } finally {
    staleRecoveryRunning = false
  }
}
