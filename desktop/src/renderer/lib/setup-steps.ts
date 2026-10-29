import type { CalendarSnapshot } from '../../shared/calendar-contract'
import type { CloudAuthStatus } from '../../shared/cloud-auth-contract'
import type { ManagedRuntimeSnapshot } from '../../shared/contracts'
import type { UsageSharing } from '../../shared/usage-report'
import type { SetupPermissionStatus } from '../hooks/use-setup-permissions'

export type SetupStepState = 'todo' | 'working' | 'blocked' | 'error' | 'done' | 'skipped'

export type SetupSteps = {
  account: SetupStepState | null
  recording: SetupStepState | null
  speech: SetupStepState | null
  notes: SetupStepState | null
  calendar: SetupStepState | null
  usage: SetupStepState | null
}

export type SetupSkips = { notes: boolean; calendar: boolean }

/** The account step asks only new installs. answered is true after a skip or a sign-in. */
export type AccountAsk = { account: CloudAuthStatus | null; asks: boolean | null; answered: boolean }

const NOTES_PREPARING = new Set<ManagedRuntimeSnapshot['operation']>(['starting_runtime', 'pulling_model', 'saving_config'])

/**
 * The state of each first-run step, or null while it is still unknown or does
 * not apply. Unknown steps never show the checklist, so returning users do not
 * see it flash while status loads.
 */
export function setupSteps(permission: SetupPermissionStatus, runtime: ManagedRuntimeSnapshot | null, calendar: CalendarSnapshot | null, skips: SetupSkips, usage: UsageSharing | null, account: AccountAsk): SetupSteps {
  return { account: accountStep(account), recording: recordingStep(permission), speech: speechStep(runtime), notes: notesStep(runtime, skips.notes), calendar: calendarStep(calendar, skips.calendar), usage: usageStep(usage) }
}

/** The checklist stays while any step that applies is not done or skipped. */
export function setupVisible(steps: SetupSteps): boolean {
  return Object.values(steps).some((state) => state !== null && state !== 'done' && state !== 'skipped')
}

/**
 * First-time notes setup belongs to the checklist. A runtime that was set up
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
  return runtime.configured || NOTES_PREPARING.has(runtime.operation) ? 'waiting' : 'off'
}

/** The account comes first. Once it is answered, a later sign-out does not ask again. */
function accountStep({ account, asks, answered }: AccountAsk): SetupStepState | null {
  if (!asks || !account) return null
  if (account.email) return 'done'
  if (account.pending) return 'working'
  return answered ? 'skipped' : 'todo'
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

/** Notes are optional: "Not now" finishes the step until the user chooses in Settings. */
function notesStep(runtime: ManagedRuntimeSnapshot | null, skipped: boolean): SetupStepState | null {
  if (runtime?.operation === 'ready') return 'done'
  if (!localAiNeedsFirstSetup(runtime)) return null
  if (NOTES_PREPARING.has(runtime!.operation)) return 'working'
  if (skipped) return 'skipped'
  return runtime!.operation === 'error' ? 'error' : 'todo'
}

/** Usage sharing is asked once, also of users who finished setup before the question existed. */
function usageStep(sharing: UsageSharing | null): SetupStepState | null {
  if (!sharing) return null
  if (sharing === 'unset') return 'todo'
  return sharing === 'on' ? 'done' : 'skipped'
}

function calendarStep(calendar: CalendarSnapshot | null, skipped: boolean): SetupStepState | null {
  if (!calendar?.configured) return null
  if (calendar.connections.length) return 'done'
  return skipped ? 'skipped' : 'todo'
}
