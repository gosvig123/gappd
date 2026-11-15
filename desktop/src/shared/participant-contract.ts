import type { CalendarEventSummary } from './calendar-contract'

export type { Person as SavedPerson, ImportPeopleResponse as ImportPeopleResult, UpdatePersonInput, MergePeopleInput, PersonActionItem, PersonFact, PersonFactsResponse as PersonFacts, PersonSummaryResponse as PersonSummary, HidePersonFactInput, AssignSpeakerInput, SpeakerClipInput, SpeakerClipResponse as SpeakerClip } from './generated/contracts'
export type ParticipantContext = { event?: CalendarEventSummary; inferenceDisabled?: boolean; candidates: CalendarEventSummary[] }
export type LinkCalendarInput = { id: string; eventSourceId: string }
