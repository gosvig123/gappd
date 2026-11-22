import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem } from '../shared/contracts'
import type { AssignSpeakerInput, HidePersonFactInput, MergePeopleInput, SpeakerClipInput, UpdatePersonInput } from '../shared/participant-contract'
import { requestCommand } from './app-protocol'
import { requestDrains, requestPersonFacts, requestSpeakerRecognition } from './drain-coordinator'
import { usingSummaryRuntime } from './summary-runtime'
import { forgetMeetingCalendar } from './participant-calendar'
import { forgetAgendaMeeting } from './agenda'
import { logFailure } from './error-log'

export async function getDevices(): Promise<Device[]> {
  const result = await requestCommand('devices.list', {})
  return result.devices
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const result = await requestCommand('meetings.list', {})
  return result.meetings
}

export async function searchMeetings(query: string): Promise<string[]> {
  const cleaned = query.replace(/\0/g, ' ').trim()
  if (!cleaned) return []
  const result = await requestCommand('meetings.search', { query: cleaned })
  return result.ids
}

export async function showMeeting(id: string): Promise<MeetingDetail> {
  const result = await requestCommand('meetings.show', { id })
  return result.meeting
}

export async function retryDiarization(id: string): Promise<MeetingDetail> {
  const result = await requestCommand('meetings.retryDiarization', { id })
  requestDrains()
  return result.meeting
}

/** The new transcript, speaker labels and notes come from the processing queue. */
export async function setMeetingLanguage(id: string, language: string): Promise<MeetingDetail> {
  const result = await requestCommand('meetings.setLanguage', { id: String(id), language: String(language) })
  requestDrains()
  return result.meeting
}

export async function deleteMeeting(id: string): Promise<MeetingDeleteResponse> {
  const result = await requestCommand('meetings.delete', { id }).catch((cause) => {
    logFailure('meeting.delete', 'Delete Meeting failed:', cause)
    throw new Error('Could not delete this Meeting. Stop recording or wait for processing, check managed-file permissions, then retry from the Meeting list.')
  })
  // Its labeled voices leave the profiles that name speakers in other Meetings.
  requestSpeakerRecognition()
  await forgetMeetingCalendar(id).catch((cause) => {
    logFailure('meeting.delete-context', 'Meeting context cleanup failed:', cause)
    result.artifactWarning = 'The Meeting was deleted, but related local context could not be removed.'
  })
  await forgetAgendaMeeting(id).catch((cause) => {
    logFailure('meeting.delete-agenda', 'Meeting agenda cleanup failed:', cause)
    result.artifactWarning = 'The Meeting was deleted, but related local context could not be removed.'
  })
  return result
}

export async function listPeople() {
  return (await requestCommand('meetings.people', {})).people
}

// Renaming or merging People can rewrite transcripts, so their summaries need a processing pass.
export async function updatePerson(input: UpdatePersonInput) {
  const { people } = await requestCommand('meetings.updatePerson', input)
  requestDrains()
  return people
}

export async function personActionItems(id: string) {
  return (await requestCommand('meetings.personActionItems', { id })).items
}

export async function personFacts(id: string) {
  return requestCommand('meetings.personFacts', { id })
}

export async function hidePersonFact(input: HidePersonFactInput) {
  return requestCommand('meetings.hidePersonFact', input)
}

// The background step reads the queued Meetings; the page hears of new facts from onPersonFactsChanged.
export async function queuePersonFacts(id: string) {
  const facts = await requestCommand('meetings.queuePersonFacts', { id })
  requestPersonFacts()
  return facts
}

const summaryWrites = new Map<string, ReturnType<typeof writePersonSummary>>()

// Writing a summary uses the notes provider, so it needs Local AI when that is the provider.
// Writes for one Person run one after another. A write that finds the facts unchanged returns the
// saved summary without the provider, so a page opened again during a write costs no second call,
// and a Hide during a write still gets a summary of the facts shown after it.
export async function personSummary(id: string, write: boolean) {
  if (!write) return requestCommand('meetings.personSummary', { id })
  const previous = summaryWrites.get(id)
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => writePersonSummary(id))
  summaryWrites.set(id, next)
  return next.finally(() => { if (summaryWrites.get(id) === next) summaryWrites.delete(id) })
}

function writePersonSummary(id: string) {
  return usingSummaryRuntime((env) => requestCommand('meetings.personSummary', { id, write: true }, env))
}

export async function mergePeople(input: MergePeopleInput) {
  const { people } = await requestCommand('meetings.mergePeople', input)
  requestDrains()
  return people
}

export async function assignSpeaker(input: AssignSpeakerInput): Promise<MeetingDetail> {
  const { meeting } = await requestCommand('meetings.assignSpeaker', input)
  requestDrains()
  return meeting
}

export function speakerClip(input: SpeakerClipInput) {
  return requestCommand('meetings.speakerClip', input)
}
