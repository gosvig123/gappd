import type { CloudAuthStatus } from './cloud-auth-contract'

export type DemoUploadStatus = {
  available: boolean
  account: CloudAuthStatus
  consent: boolean
  deleteConsent: boolean
  sending: boolean
  result: string | null
}
