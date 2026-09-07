import type { LiveActionsResponse } from '../../shared/generated/live-actions'

// Keep read invalidation alive when the generating panel unmounts.
let revision = 0
export async function generateLiveActions(id: string): Promise<LiveActionsResponse> {
  revision++
  try { return await window.gappd.meetings.generateLiveActions(id) }
  finally { revision++ }
}

export async function readMeeting(id: string) {
  let started: number, meeting
  do {
    started = revision
    meeting = await window.gappd.meetings.show(id)
  } while (started !== revision)
  return meeting
}
