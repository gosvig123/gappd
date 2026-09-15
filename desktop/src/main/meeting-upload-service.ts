import { shell } from 'electron'
import type { MeetingSyncDocument } from '../shared/meeting-sync-contract'
import { CloudAuth, type CloudCredential } from './cloud-auth'
import { createSecureStore, requireEncryption } from './electron-secure-store'
import { MeetingDevice, type DeviceCredential } from './meeting-device'
import { meetingDocumentLoader } from './meeting-document-loader'
import { listMeetings } from './meetings'
import { resolveGappdBinary } from './native-runtime'
import { MeetingSyncQueue } from './meeting-sync-queue'
import { MeetingUpload } from './meeting-upload'
import { cloudAuthConfig, cloudResource } from './service-config'

/**
 * Cloud Meeting upload is a separate capability from the authentication-only preview, with its
 * own credentials. The preview's credential must never become upload authority, so this keeps a
 * distinct protected store even though it uses the same development identity.
 */
const capabilityFlag = 'GAPPD_MEETING_UPLOAD_ENABLED'

let instance: MeetingUpload | null = null
let authorization: CloudAuth | null = null

export function meetingUploadAuthorization(): CloudAuth {
  authorization ||= new CloudAuth({ ...cloudAuthConfig(), resource: cloudResource() },
    createSecureStore<CloudCredential>('cloud-upload-development.enc'), {
      openExternal: (url) => shell.openExternal(url), requireSecureStorage: requireEncryption,
    })
  return authorization
}

declare const __GAPPD_MEETING_UPLOAD_ENABLED__: string

/** A packaged build carries the capability; a development run can still turn it on per shell. */
function uploadCapability(): boolean {
  if (typeof __GAPPD_MEETING_UPLOAD_ENABLED__ === 'string' && __GAPPD_MEETING_UPLOAD_ENABLED__.trim() === 'true') return true
  return process.env[capabilityFlag] === 'true'
}

export function meetingUpload(): MeetingUpload {
  instance ||= new MeetingUpload(meetingUploadAuthorization(), cloudResource(),
    uploadCapability(),
    new MeetingSyncQueue(createSecureStore<MeetingSyncDocument>('meeting-upload-development.enc')),
    meetingDocumentLoader(resolveGappdBinary),
    async () => (await listMeetings()).map((meeting) => meeting.id),
    new MeetingDevice(createSecureStore<DeviceCredential>('meeting-device-development.enc')))
  return instance
}

export async function cancelMeetingUpload(): Promise<void> {
  if (authorization) await authorization.setEnabled(false)
}
