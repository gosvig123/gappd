import { useEffect, useMemo } from 'react'
import type { MeetingListItem, RecordingState } from '../../shared/contracts'
import { needsRecordingRefresh } from '../../shared/meeting-recording-workflow'

const DYNAMIC_REFRESH_INTERVAL_MS = 5000
const DYNAMIC_REFRESH_MEETING_STATES: MeetingListItem['status']['state'][] = ['recording', 'pending', 'processing']
const VISIBLE_DOCUMENT_STATE: DocumentVisibilityState = 'visible'

type RefreshMeetings = (id?: string | null) => Promise<void>

/**
 * Keeps the meeting list fresh: refreshes on focus/visibility, and polls on an
 * interval while a recording is active or any meeting is still processing.
 */
export function useDynamicRefresh(enabled: boolean, meetings: MeetingListItem[], recording: RecordingState, getSelectedId: () => string | null, refreshMeetings: RefreshMeetings): void {
  const hasWork = useMemo(() => needsDynamicRefresh(meetings, recording), [meetings, recording.status])
  useVisibleRefresh(enabled, refreshMeetings)
  useIntervalRefresh(enabled && hasWork, recording.meetingId, getSelectedId, refreshMeetings)
}

function useVisibleRefresh(enabled: boolean, refreshMeetings: RefreshMeetings): void {
  useEffect(() => {
    if (!enabled) return undefined
    const refresh = () => { if (document.visibilityState === VISIBLE_DOCUMENT_STATE) void refreshMeetings().catch(console.error) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [enabled])
}

function useIntervalRefresh(enabled: boolean, recordingMeetingId: string | undefined, getSelectedId: () => string | null, refreshMeetings: RefreshMeetings): void {
  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => void refreshMeetings(getSelectedId() ?? recordingMeetingId).catch(console.error), DYNAMIC_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [enabled, recordingMeetingId])
}

function needsDynamicRefresh(meetings: MeetingListItem[], recording: RecordingState): boolean {
  if (needsRecordingRefresh(recording.status)) return true
  return meetings.some((meeting) => DYNAMIC_REFRESH_MEETING_STATES.includes(meeting.status.state))
}
