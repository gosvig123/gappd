import type { CalendarEventSummary } from './calendar-contract'
import type { AgendaSource } from './meeting-agenda'
import type { ParticipantContext } from './participant-contract'

export type EnrichmentStatus = 'context' | 'possibly_done'
/** Context for one action item that already exists in the Meeting summary. */
export type MeetingEnrichmentNote = { actionItem: string; status: EnrichmentStatus; note: string; sourceId: string; quote: string }
export type MeetingEnrichment = {
  meetingId: string
  generatedAt: string
  eventTitle: string
  messageCount: number
  notes: MeetingEnrichmentNote[]
  /** Labels of cited messages only; message bodies are never stored. */
  sources: AgendaSource[]
  warning?: string
  generation?: { model?: string; reasoningEffort?: string }
  /** True when the summary changed after these notes were made. */
  stale: boolean
}

/** A confirmed link wins; otherwise use one unambiguous overlapping event, unless the user unlinked it. */
export function enrichmentEvent(context: ParticipantContext): CalendarEventSummary {
  if (context.event) return context.event
  if (!context.inferenceDisabled && context.candidates.length === 1) return context.candidates[0]!
  throw new Error(context.candidates.length > 1
    ? 'Add Gmail and Slack context: several Calendar events overlap this Meeting. Choose its Calendar event under “People in this meeting”, then try again.'
    : context.inferenceDisabled
      ? 'Add Gmail and Slack context: automatic Calendar matching is off for this Meeting. Choose its Calendar event under “People in this meeting”, then try again.'
      : 'Add Gmail and Slack context: no Calendar event matches this Meeting, so Gappd cannot find its invitees. Refresh Calendar in Settings, then try again.')
}
