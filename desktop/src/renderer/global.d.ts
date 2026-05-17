import type { MeetingStatus as SharedMeetingStatus } from '../shared/contracts'
import type { GappdApi } from '../shared/ipc-contract'

export {}

declare global {
  type MeetingStatus = SharedMeetingStatus

  interface Window {
    gappd: GappdApi
  }
}
