import type { CloudAuthStatus } from '../../shared/cloud-auth-contract'
import type { ManagedRuntimeSnapshot } from '../../shared/contracts'
import type { SetupPermissionStatus } from '../hooks/use-setup-permissions'

export type SetupStepState = 'todo' | 'working' | 'blocked' | 'error' | 'done'

/**
 * First-run setup has only what Record needs. Notes, AI apps, Calendar, and
 * usage sharing are asked later, when they first help (see feature-prompts.ts).
 */
export type SetupSteps = {
  account: SetupStepState | null
  recording: SetupStepState | null
  speech: SetupStepState | null
}

/** The account step asks only new installs. signedIn is true after the first sign-in. */
export type AccountAsk = { account: CloudAuthStatus | null; asks: boolean | null; signedIn: boolean }

const NOTES_PREPARING = new Set<ManagedRuntimeSnapshot['operation']>(['starting_runtime', 'pulling_model', 'saving_config'])

/**
 * The state of each first-run step, or null while it is still unknown or does
 * not apply. Unknown steps never show the checklist, so returning users do not
 * see it flash while status loads.
 */
export function setupSteps(permission: SetupPermissionStatus, runtime: ManagedRuntimeSnapshot | null, account: AccountAsk): SetupSteps {
  return { account: accountStep(account), recording: recordingStep(permission), speech: speechStep(runtime) }
}

/**
 * The checklist stays while the account or recording step is open, or while the
 * speech model failed. A speech model that is still downloading needs no action.
 */
export function setupVisible(steps: SetupSteps): boolean {
  return [steps.account, steps.recording].some((state) => state !== null && state !== 'done') || steps.speech === 'error'
}

/**
 * First-time notes setup belongs to the notes prompt. A runtime that was set up
 * before and later needs repair stays with the notifications.
 */
export function localAiNeedsFirstSetup(runtime: ManagedRuntimeSnapshot | null): boolean {
  if (!runtime || runtime.operation === 'checking' || runtime.operation === 'ready') return false
  return runtime.operation === 'needs_setup' || !runtime.configured
}

export type NotesAvailability = 'ready' | 'off' | 'waiting'

/**
 * Whether Gappd can write Meeting notes now, or null while unknown. Notes are
 * off until the user chooses where they are made; they wait while the chosen
 * provider is getting ready or unavailable. Waiting Meetings get notes later.
 */
export function notesAvailability(runtime: ManagedRuntimeSnapshot | null): NotesAvailability | null {
  if (!runtime || runtime.operation === 'checking') return null
  if (runtime.capabilities.summarization.readiness === 'ready') return 'ready'
  return runtime.configured || notesPreparing(runtime) ? 'waiting' : 'off'
}

/** The model on this Mac is downloading or starting for notes. */
export function notesPreparing(runtime: ManagedRuntimeSnapshot | null): boolean {
  return Boolean(runtime && NOTES_PREPARING.has(runtime.operation))
}

/** The account comes first and has no skip. After a sign-in, a later sign-out does not ask again. */
function accountStep({ account, asks, signedIn }: AccountAsk): SetupStepState | null {
  if (!asks || !account) return null
  if (account.email) return 'done'
  if (account.pending) return 'working'
  return signedIn ? null : 'todo'
}

function recordingStep(permission: SetupPermissionStatus): SetupStepState | null {
  switch (permission) {
    case 'waiting': return null
    case 'checking': return 'working'
    case 'granted': return 'done'
    case 'blocked': return 'blocked'
    case 'error': return 'error'
    case 'unknown': return 'todo'
  }
}

/** Transcripts need Apple's speech model. It downloads by itself, so this step only reports it. */
function speechStep(runtime: ManagedRuntimeSnapshot | null): SetupStepState | null {
  if (!runtime) return null
  const readiness = runtime.capabilities.transcription.readiness
  if (readiness === 'preparing') return 'working'
  // Every launch starts as checking with the model missing, so that state is unknown, not unfinished.
  if (readiness === 'missing' && runtime.operation === 'checking') return null
  return readiness === 'missing' ? 'error' : 'done'
}
