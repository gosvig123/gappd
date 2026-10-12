import type { CalendarSnapshot } from '../../shared/calendar-contract'
import type { ManagedRuntimeSnapshot } from '../../shared/contracts'
import type { SetupPermissionStatus } from '../hooks/use-setup-permissions'

export type SetupStepState = 'todo' | 'working' | 'blocked' | 'error' | 'done' | 'skipped'

export type SetupSteps = {
  recording: SetupStepState | null
  localAi: SetupStepState | null
  calendar: SetupStepState | null
}

/**
 * The state of each first-run step, or null while it is still unknown or does
 * not apply. Unknown steps never show the checklist, so returning users do not
 * see it flash while status loads.
 */
export function setupSteps(permission: SetupPermissionStatus, runtime: ManagedRuntimeSnapshot | null, calendar: CalendarSnapshot | null, calendarSkipped: boolean): SetupSteps {
  return { recording: recordingStep(permission), localAi: localAiStep(runtime), calendar: calendarStep(calendar, calendarSkipped) }
}

/** The checklist stays while any step that applies is not done or skipped. */
export function setupVisible(steps: SetupSteps): boolean {
  return Object.values(steps).some((state) => state !== null && state !== 'done' && state !== 'skipped')
}

/**
 * First-time Local AI setup belongs to the checklist. A runtime that was set up
 * before and later needs repair stays with the notifications.
 */
export function localAiNeedsFirstSetup(runtime: ManagedRuntimeSnapshot | null): boolean {
  if (!runtime || runtime.operation === 'checking' || runtime.operation === 'ready') return false
  return runtime.operation === 'needs_setup' || !runtime.configured
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

function localAiStep(runtime: ManagedRuntimeSnapshot | null): SetupStepState | null {
  if (runtime?.operation === 'ready') return 'done'
  if (!localAiNeedsFirstSetup(runtime)) return null
  if (runtime!.operation === 'needs_setup') return 'todo'
  if (runtime!.operation === 'error') return 'error'
  return 'working'
}

function calendarStep(calendar: CalendarSnapshot | null, skipped: boolean): SetupStepState | null {
  if (!calendar?.configured) return null
  if (calendar.connections.length) return 'done'
  return skipped ? 'skipped' : 'todo'
}
