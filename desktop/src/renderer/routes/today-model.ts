import type { Device, RecordingStatus } from '../../shared/contracts'
import { RECORDING_STATUS_PROCESSING, RECORDING_STATUS_RECORDING, RECORDING_STATUS_STOPPING } from '../../shared/meeting-recording-workflow'

export const EMPTY_TITLE = 'Untitled meeting'

export type CaptureReadiness = {
  detail: string
}

export function dateLabel(value: string): string {
  return new Date(value).toLocaleString()
}

export function readyState(canStart: boolean, devices: Device[], status: RecordingStatus): CaptureReadiness {
  if (status === RECORDING_STATUS_RECORDING) return { detail: 'Stop when meeting ends. Progress appears while notes finish.' }
  if (status === RECORDING_STATUS_STOPPING) return { detail: 'Stopping recording. Notes start after audio saves.' }
  if (status === RECORDING_STATUS_PROCESSING) return { detail: 'Meeting saved. Finishing notes locally. Keep app open.' }
  if (!devices.length) return { detail: 'Connect or enable input device before recording.' }
  if (canStart) return { detail: 'Start manual capture when meeting begins.' }
  return { detail: 'Wait for current meeting before starting another.' }
}
