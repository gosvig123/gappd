import type { Device, RecordingStatus } from '../../shared/contracts'

export const EMPTY_TITLE = 'Untitled meeting'

const RECORDING_RECORDING: RecordingStatus = 'recording'

export type CaptureReadiness = {
  detail: string
}

export function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

export function readyState(canStart: boolean, canStop: boolean, devices: Device[], status: RecordingStatus): CaptureReadiness {
  if (status === RECORDING_RECORDING) return { detail: 'Stop when meeting ends. Notes appear in inbox after processing.' }
  if (canStop) return { detail: 'Audio handoff is underway. Keep app open.' }
  if (!devices.length) return { detail: 'Connect or enable input device before recording.' }
  if (canStart) return { detail: 'Start manual capture when meeting begins.' }
  return { detail: 'Wait for current meeting before starting another.' }
}
