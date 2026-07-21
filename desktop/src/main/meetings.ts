import type { Device, MeetingDeleteResponse, MeetingDetail, MeetingListItem } from '../shared/contracts'
import { requestCommand } from './app-protocol'
import { requestDrains } from './drain-coordinator'

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
  return requestCommand('meetings.delete', { id })
}
