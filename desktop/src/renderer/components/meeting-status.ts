import type { MeetingStatus } from '../../shared/contracts'

const permissionErrorHints = [
  'permission denied',
  'microphone access denied',
  'screen recording access required',
  'screen & system audio recording access required',
  'grant permission:',
  'privacy & security',
]

export function meetingStatusLabel(state: MeetingStatus['state']): string {
  switch (state) {
    case 'recording':
      return 'Recording'
    case 'captured':
      return 'Captured'
    case 'processing':
      return 'Processing'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
  }
}

export function meetingStatusTone(state: MeetingStatus['state']): 'recording' | 'processing' | 'idle' | 'error' {
  switch (state) {
    case 'recording':
      return 'recording'
    case 'processing':
      return 'processing'
    case 'failed':
      return 'error'
    case 'captured':
    case 'completed':
      return 'idle'
  }
}

export function meetingStatusPillVisible(state: MeetingStatus['state']): boolean {
  return meetingStatusTone(state) !== 'idle'
}

export function artifactLabel(ready: boolean, present: string, missing: string): string {
  return ready ? present : missing
}

export function isPermissionErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return permissionErrorHints.some((hint) => normalized.includes(hint))
}

export function permissionTarget(message: string | null | undefined): 'microphone' | 'screen-recording' | undefined {
  if (!message) return undefined
  const normalized = message.toLowerCase()
  if (normalized.includes('screen recording') || normalized.includes('screen & system audio')) return 'screen-recording'
  if (normalized.includes('microphone')) return 'microphone'
  return undefined
}
