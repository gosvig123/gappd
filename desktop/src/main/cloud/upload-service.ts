import { shell } from 'electron'
import type { MeetingSyncDocument } from '../../shared/meeting-sync-contract'
import type { ParticipantContext } from '../../shared/participant-contract'
import { CloudAuth, type CloudCredential } from './auth'
import { createSecureStore, requireEncryption } from '../electron-secure-store'
import { MeetingDevice, type DeviceCredential } from './device'
import { foldCalendarMaskStamp, meetingDocumentWithStampLoader } from './document-loader'
import { deleteMeeting, listMeetings } from '../meetings'
import { resolveGappdBinary } from '../native-runtime'
import { MeetingSyncQueue } from './sync-queue'
import { MeetingUpload } from './upload'
import { cloudAuthConfig, cloudResource } from '../service-config'
import { savedMeetingCalendarContexts } from '../participant-calendar'
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
 * Folds whether a Meeting's title is masked (via persisted `titleSource === 'calendar'` or a saved
 * Calendar event) into its documentStamp in one read. If saved Calendar contexts cannot be read or
 * an entry is malformed, strips documentStamp instead of throwing so queued Cloud deletions still
 * drain while per-Meeting exports fail before spawning the CLI.
 */
async function listMeetingsForSync(): Promise<MeetingListItem[]> {
  const meetings = await listMeetings()
  let contexts: Record<string, ParticipantContext>
  try {
    contexts = await savedMeetingCalendarContexts()
  } catch {
    return meetings.map(({ documentStamp: _unused, ...meeting }) => meeting)
  }
  return meetings.map((meeting) => {
    if (!meeting.documentStamp) return meeting
    const titles = readCalendarTitles(contexts[meeting.id])
    if (titles === null) {
      const { documentStamp: _unused, ...withoutStamp } = meeting
      return withoutStamp
    }
    const masked = meeting.titleSource === 'calendar' || titles.some((title) => title.trim() === meeting.title.trim())
    return { ...meeting, documentStamp: foldCalendarMaskStamp(meeting.documentStamp, masked) }
  })
}

async function meetingCalendarTitles(id: string): Promise<string[]> {
  const titles = readCalendarTitles((await savedMeetingCalendarContexts())[id])
  if (titles === null) throw new Error('Calendar link entry is malformed.')
  return titles
}

/** Returns null when a saved entry exists but is malformed, so it is refused for upload. */
function readCalendarTitles(context: ParticipantContext | undefined): string[] | null {
  if (context === undefined) return []
  if (!context || typeof context !== 'object' || !Array.isArray(context.candidates)) return null
  const events = context.event ? [context.event, ...context.candidates] : context.candidates
  const titles: string[] = []
  for (const event of events) {
    if (!event || typeof event !== 'object' || typeof event.title !== 'string') return null
    titles.push(event.title)
  }
  return titles
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
