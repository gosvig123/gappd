import { shell } from 'electron'
import type { MeetingSyncDocument } from '../shared/meeting-sync-contract'
import { CloudAuth, type CloudCredential } from './cloud-auth'
import { createSecureStore, requireEncryption } from './electron-secure-store'
import { meetingDocumentLoader } from './meeting-document-loader'
import { resolveGappdBinary } from './native-runtime'
import { MeetingSyncQueue } from './meeting-sync-queue'
import { MeetingUpload } from './meeting-upload'
import { cloudAuthDevelopmentConfig, cloudResource } from './service-config'

/**
 * Cloud Meeting upload is a separate capability from the authentication-only preview, with its
 * own credentials. The preview's credential must never become upload authority, so this keeps a
 * distinct protected store even though it uses the same development identity.
 */
const capabilityFlag = 'GAPPD_MEETING_UPLOAD_ENABLED'

let instance: MeetingUpload | null = null
let authorization: CloudAuth | null = null

export function meetingUploadAuthorization(): CloudAuth {
  authorization ||= new CloudAuth({ ...cloudAuthDevelopmentConfig(), resource: cloudResource() },
    createSecureStore<CloudCredential>('cloud-upload-development.enc'), {
      openExternal: (url) => shell.openExternal(url), requireSecureStorage: requireEncryption,
    })
  return authorization
}

export function meetingUpload(): MeetingUpload {
  instance ||= new MeetingUpload(meetingUploadAuthorization(), cloudResource(),
    process.env[capabilityFlag] === 'true',
    new MeetingSyncQueue(createSecureStore<MeetingSyncDocument>('meeting-upload-development.enc')),
    meetingDocumentLoader(resolveGappdBinary))
  return instance
}

export async function cancelMeetingUpload(): Promise<void> {
  if (authorization) await authorization.setEnabled(false)
}
