import type { Device, RecordingState, UpdateStatus } from '../../../shared/contracts'
import type { ManagedRuntimeSnapshot } from '../../../shared/managed-runtime'
import type { SavedPerson } from '../../../shared/participant-contract'
import { minutesLater } from './time'

export const SEED_DEVICES: Device[] = [
  { index: 0, name: 'MacBook Pro Microphone' },
  { index: 1, name: 'AirPods Pro' },
  { index: 2, name: 'Shure MV7' },
]

export const SEED_PEOPLE: SavedPerson[] = [
  { id: 'p-priya-raman', name: 'Priya Raman', email: 'priya.raman@northwind.example' },
  { id: 'p-marco-silva', name: 'Marco Silva', email: 'marco.silva@northwind.example' },
  { id: 'p-dana-whitfield', name: 'Dana Whitfield', email: 'dana.whitfield@northwind.example' },
  { id: 'p-ana-petrova', name: 'Ana Petrova', email: 'ana.petrova@petrova.example' },
  { id: 'p-krisitan-ahmadi', name: 'Krisitan Ahmadi', email: 'krisitan@northwind.example' },
]

export function seedRuntime(): ManagedRuntimeSnapshot {
  return {
    operation: 'ready', activity: 'idle',
    capabilities: {
      summarization: { readiness: 'ready' },
      transcription: { readiness: 'ready' },
      diarization: { readiness: 'ready' },
    },
    endpoint: 'http://127.0.0.1:8123', model: 'Qwen3-4B-Instruct-Q4_K_M.gguf',
    message: 'Local AI is ready. Transcript text and audio stay on this Mac.',
    supported: true, configured: true, bundled: true, running: true, canRetry: false, canRepair: true,
  }
}

export function seedUpdateStatus(): UpdateStatus {
  return { phase: 'available', available: true, currentVersion: '0.1.7', channel: 'beta', latestVersion: '0.2.0', name: 'Gappd 0.2.0', releaseUrl: 'https://github.com/gappd-dev/gappd/releases' }
}

export function seedRecording(): RecordingState {
  return { status: 'idle' }
}

export const SEED_STARTUP = { openAtLogin: true, supported: true, requiresApproval: false, speakerLabelsEnabled: true }

/**
 * Seeded Meeting to Calendar event links, by event id. Two of these have a saved
 * Agenda draft and one does not, so every Agenda state is reachable in the UI.
 * The remaining Meetings stay unlinked on purpose.
 */
export const SEED_MEETING_EVENT_LINKS: Record<string, string> = {
  'm-01': 'e-sync',
  'm-05': 'e-planning',
  'm-06': 'e-interview',
}

export function seedStaleRecoveryNotice(): string | null {
  return null
}

export function seedLastRefreshed(): string {
  return minutesLater(new Date(), -2).toISOString()
}
