import type { CloudAuthStatus } from './cloud-auth-contract'

export const SELECTED_FIXTURE_ID = '72619a1d-f713-4f46-a2b8-c74e568726b1'
export const SELECTED_FIXTURE_BYTES = '{"version":1,"local_id":"72619a1d-f713-4f46-a2b8-c74e568726b1","title":"SYNTHETIC: Selected local Meeting","transcript":"[00:00] Synthetic speaker: Review the fictional paper prototype.","summary":"Fabricated participants will review a fictional paper prototype.","started_at":"2026-09-14T12:00:00Z","revision":1}'

export type SelectedFixtureStatus = {
  available: boolean
  account: CloudAuthStatus
  preview: string | null
  consent: boolean
  deleteConsent: boolean
  sending: boolean
  result: string | null
}
