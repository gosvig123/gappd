export type ManagedRuntimeCapability = 'summarization' | 'transcription' | 'diarization'
export type ManagedRuntimeReadiness = 'ready' | 'missing' | 'unavailable'

export type ManagedRuntimeOperation =
  | 'checking'
  | 'needs_setup'
  | 'starting_runtime'
  | 'pulling_model'
  | 'saving_config'
  | 'ready'
  | 'error'

export type ManagedRuntimePullStage = 'preparing' | 'downloading' | 'verifying' | 'finalizing' | 'complete'
export type ManagedRuntimeErrorKind = 'pull_timeout' | 'pull_network' | 'pull_blob_host_network' | 'disk_space' | 'permission' | 'ownership_mismatch' | 'runtime'

export type ManagedRuntimeErrorDebug = { rawDetail?: string; url?: string; host?: string; ip?: string }
export type OwnershipConflict = { pid: number; port: number; summary?: string; stopCommand?: string }
export type CapabilitySnapshot = { readiness: ManagedRuntimeReadiness; message?: string }

export type ManagedRuntimeSnapshot = {
  operation: ManagedRuntimeOperation
  activity: 'idle' | 'in_use' | 'closing'
  capabilities: Record<ManagedRuntimeCapability, CapabilitySnapshot>
  endpoint: string
  model: string
  message: string
  supported: boolean
  configured: boolean
  bundled: boolean
  running: boolean
  canRetry: boolean
  canRepair: boolean
  progress?: number
  pullStage?: ManagedRuntimePullStage
  error?: string
  errorDetail?: string
  debugDetail?: string
  errorDebug?: ManagedRuntimeErrorDebug
  errorKind?: ManagedRuntimeErrorKind
  ownershipConflict?: OwnershipConflict
}

export type ManagedRuntimePrepareMode = 'setup' | 'repair'
