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

// The store names keep their original "development" suffix, so existing installs keep their
// upload account, consent, queue and device key.
let instance: MeetingUpload | null = null
let authorization: CloudAuth | null = null

function meetingUploadAuthorization(): CloudAuth {
  authorization ||= new CloudAuth({ ...cloudAuthConfig(), resource: cloudResource(), refreshTokens: true },
    createSecureStore<CloudCredential>('cloud-upload-development.enc'), {
      openExternal: (url) => shell.openExternal(url), requireSecureStorage: requireEncryption,
    })
  return authorization
}

export function meetingUpload(): MeetingUpload {
  instance ||= new MeetingUpload(meetingUploadAuthorization(), cloudResource(),
    new MeetingSyncQueue(createSecureStore<MeetingSyncDocument>('meeting-upload-development.enc')),
    meetingDocumentLoader(resolveGappdBinary),
    listMeetings,
    new MeetingDevice(createSecureStore<DeviceCredential>('meeting-device-development.enc')))
  return instance
}
