import type { AIAppStatus } from '../../shared/ai-apps'
import type { UsageSharing } from '../../shared/usage-report'
import type { NotesAvailability } from './setup-steps'

/**
 * A Feature prompt asks about one optional feature at the moment it first helps,
 * instead of in first-run setup. Gappd shows at most one at a time.
 */
export type FeaturePrompt = 'notes' | 'aiApps' | 'account' | 'usage'

/** Usage counts are asked once the person has used Gappd for a few Meetings. */
export const USAGE_PROMPT_MEETINGS = 3

export type FeaturePromptFacts = {
  /** First-run setup is on screen; it comes first. */
  setupOpen: boolean
  meetings: ReadonlyArray<{ hasTranscript: boolean; hasSummary: boolean }>
  notes: NotesAvailability | null
  /** null until read; read only when wantsAIAppsStatus is true. */
  aiApps: ReadonlyArray<AIAppStatus> | null
  /** A signed-out install from before the required account saw notes become ready. */
  accountAsk: boolean
  usage: UsageSharing | null
  answered: { notes: boolean; aiApps: boolean }
}

/**
 * The prompt to show now, or null. The facts come from saved data, so a prompt
 * still comes after a relaunch and also reaches people who installed earlier.
 * - notes: the first transcript exists and notes are off.
 * - aiApps: the first notes exist, and an AI app is installed but none is connected.
 * - account: the earlier account prompt for installs from before the required account.
 * - usage: sharing is unanswered after a few Meetings.
 */
export function nextFeaturePrompt(facts: FeaturePromptFacts): FeaturePrompt | null {
  if (facts.setupOpen) return null
  if (facts.notes === 'off' && !facts.answered.notes && facts.meetings.some((meeting) => meeting.hasTranscript)) return 'notes'
  if (wantsAIAppsStatus(facts) && aiAppToConnect(facts.aiApps)) return 'aiApps'
  if (facts.accountAsk) return 'account'
  if (facts.usage === 'unset' && facts.meetings.length >= USAGE_PROMPT_MEETINGS) return 'usage'
  return null
}

/** The AI apps status is read only when its prompt can apply. */
export function wantsAIAppsStatus(facts: Pick<FeaturePromptFacts, 'setupOpen' | 'meetings' | 'answered'>): boolean {
  return !facts.setupOpen && !facts.answered.aiApps && facts.meetings.some((meeting) => meeting.hasSummary)
}

function aiAppToConnect(apps: FeaturePromptFacts['aiApps']): boolean {
  if (!apps) return false
  return apps.some((app) => app.state === 'off') && !apps.some((app) => app.state === 'on' || app.state === 'outdated')
}
