import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem } from '../shared/contracts'
import type { AssignSpeakerInput, SpeakerClipInput } from '../shared/participant-contract'
import { requestCommand } from './app-protocol'
import { requestDrains } from './drain-coordinator'
import { forgetMeetingCalendar } from './participant-calendar'
import { forgetMeetingEnrichment } from './meeting-enrichment'

export async function getDevices(): Promise<Device[]> {
  const result = await requestCommand('devices.list', {})
  return result.devices
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const result = await requestCommand('meetings.list', {})
  return result.meetings
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

export async function deleteMeeting(id: string): Promise<MeetingDeleteResponse> {
  const result = await requestCommand('meetings.delete', { id }).catch((cause) => {
    console.error('Delete Meeting failed:', cause)
    throw new Error('Could not delete this Meeting. Stop recording or wait for processing, check managed-file permissions, then retry from the Meeting list.')
  })
  for (const forget of [forgetMeetingCalendar, forgetMeetingEnrichment]) {
    await forget(id).catch((cause) => {
      console.error('Meeting context cleanup failed:', cause)
      result.artifactWarning = 'The Meeting was deleted, but related local context could not be removed.'
    })
  }
  return result
}

export async function listPeople() {
  return (await requestCommand('meetings.people', {})).people
}

export async function assignSpeaker(input: AssignSpeakerInput): Promise<MeetingDetail> {
  const { meeting } = await requestCommand('meetings.assignSpeaker', input)
  requestDrains()
  return meeting
}

export function speakerClip(input: SpeakerClipInput) {
  return requestCommand('meetings.speakerClip', input)
}
