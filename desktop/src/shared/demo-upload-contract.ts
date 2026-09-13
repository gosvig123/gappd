import type { CloudAuthStatus } from './cloud-auth-contract'

export type DemoUploadStatus = {
  available: boolean
  account: CloudAuthStatus
  consent: boolean
  sending: boolean
  result: string | null
}
