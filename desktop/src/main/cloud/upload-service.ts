import { shell } from 'electron'
import type { MeetingSyncDocument } from '../../shared/meeting-sync-contract'
import type { ParticipantContext } from '../../shared/participant-contract'
import { CloudAuth, type CloudCredential } from './auth'
import { createSecureStore, requireEncryption } from '../electron-secure-store'
import { MeetingDevice, type DeviceCredential } from './device'
import { foldCalendarMaskStamp, meetingDocumentWithStampLoader } from './document-loader'
import { googleCalendarSnapshot } from '../google/calendar-service'
import { deleteMeeting, listMeetings } from '../meetings'
import { resolveGappdBinary } from '../native-runtime'
import { MeetingSyncQueue } from './sync-queue'
import { MeetingUpload } from './upload'
import { cloudAuthConfig, cloudResource } from '../service-config'
import { overlappingCalendarTitles, savedMeetingCalendarContexts } from '../participant-calendar'
import type { MeetingDeleteResponse, MeetingListItem } from '../../shared/contracts'

// The store names keep their original "development" suffix, so existing installs keep their
// upload account, consent, queue and device key.
let instance: MeetingUpload | null = null
let authorization: CloudAuth | null = null

/** The signed-in Gappd account. Uploads and remote access share it. */
export function meetingUploadAuthorization(): CloudAuth {
  authorization ||= new CloudAuth({ ...cloudAuthConfig(), resource: cloudResource(), refreshTokens: true },
    createSecureStore<CloudCredential>('cloud-upload-development.enc'), {
      openExternal: (url) => shell.openExternal(url), requireSecureStorage: requireEncryption,
    })
  return authorization
}

export function meetingUpload(): MeetingUpload {
  instance ||= new MeetingUpload(meetingUploadAuthorization(), cloudResource(),
    new MeetingSyncQueue(createSecureStore<MeetingSyncDocument>('meeting-upload-development.enc')),
    meetingDocumentWithStampLoader(resolveGappdBinary, meetingCalendarTitles),
    listMeetingsForSync,
    new MeetingDevice(createSecureStore<DeviceCredential>('meeting-device-development.enc')))
  return instance
}

/**
 * Folds whether a Meeting's title is masked by a saved or overlapping Calendar event into its
 * documentStamp in one read. If saved Calendar contexts cannot be read (e.g. damaged store),
 * strips documentStamp instead of throwing so queued Cloud deletions still drain while per-Meeting
 * exports refuse to run without masking context.
 */
async function listMeetingsForSync(): Promise<MeetingListItem[]> {
  const meetings = await listMeetings()
  let contexts: Record<string, ParticipantContext>
  try {
    contexts = await savedMeetingCalendarContexts()
  } catch {
    return meetings.map(({ documentStamp: _unused, ...meeting }) => meeting)
  }
  const calendarEvents = await googleCalendarSnapshot().then((snapshot) => snapshot.events).catch(() => [])
  return meetings.map((meeting) => {
    if (!meeting.documentStamp) return meeting
    const titles = [
      ...calendarTitlesOf(contexts[meeting.id]),
      ...overlappingCalendarTitles(calendarEvents, meeting.startedAt, meeting.endedAt),
    ]
    const masked = titles.some((title) => title.trim() === meeting.title.trim())
    return { ...meeting, documentStamp: foldCalendarMaskStamp(meeting.documentStamp, masked) }
  })
}

async function meetingCalendarTitles(id: string, startedAt?: string, endedAt?: string): Promise<string[]> {
  const context = (await savedMeetingCalendarContexts())[id]
  const saved = calendarTitlesOf(context)
  if (!startedAt) return saved
  const calendarEvents = await googleCalendarSnapshot().then((snapshot) => snapshot.events).catch(() => [])
  return [...saved, ...overlappingCalendarTitles(calendarEvents, startedAt, endedAt)]
}

function calendarTitlesOf(context: ParticipantContext | undefined): string[] {
  if (!context) return []
  return [context.event, ...context.candidates].flatMap((event) => event ? [event.title] : [])
}

/**
 * Deletes a local Meeting after recording the deletion of its cloud copy, so a copy never outlives
 * its Meeting unnoticed. When the record cannot be saved, the Meeting is not deleted.
 */
export async function deleteMeetingAndCloudCopy(id: string): Promise<MeetingDeleteResponse> {
  try {
    await meetingUpload().forgetLocal(id)
  } catch {
    throw new Error('Could not record the cloud deletion for this Meeting, so nothing was deleted. Unlock this Mac, then delete the Meeting again.')
  }
  return deleteMeeting(id)
}
