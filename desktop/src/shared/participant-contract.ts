import type { CalendarEventSummary } from './calendar-contract'

export type { Person as SavedPerson, AssignSpeakerInput, SpeakerClipInput, SpeakerClipResponse as SpeakerClip } from './generated/contracts'
export type ParticipantContext = { event?: CalendarEventSummary; candidates: CalendarEventSummary[] }
export type LinkCalendarInput = { id: string; eventSourceId: string }
