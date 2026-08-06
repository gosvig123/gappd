const permissionErrorHints = [
  'permission denied',
  'microphone access denied',
  'screen recording access required',
  'screen & system audio recording access required',
  'grant permission:',
  'privacy & security',
]

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
