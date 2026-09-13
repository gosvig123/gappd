import type { CloudAuthStatus } from './cloud-auth-contract'
import type { MeetingSyncStatus } from './meeting-sync-contract'

/**
 * Cloud Meeting upload state. `consent` is the explicit feature consent, which is separate
 * from signing in: an account alone never permits an upload.
 */
export type MeetingUploadStatus = {
  available: boolean
  account: CloudAuthStatus
  consent: boolean
  deleteConsent: boolean
  sending: boolean
  result: string | null
  queue: MeetingSyncStatus
}

export const MEETING_UPLOAD_CONSENT_TEXT =
  'Upload Meeting text to Gappd Cloud. Gappd Cloud and any AI client you authorize can read it. ' +
  'It includes the title, summary, transcript turns with timestamps, and Meeting speaker labels, ' +
  'which are a person\'s name when you labeled that speaker. Audio, voice samples, saved agendas ' +
  'and the people directory stay on this Mac. Cloud copies expire 30 days after upload, and turning ' +
  'sync off stops new uploads without deleting cloud copies.'
