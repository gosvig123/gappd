import type { MeetingListItem } from '../../shared/contracts'

const DAY_MS = 24 * 60 * 60 * 1000

/** Synchronous match on Meeting title and speaker names; full-text search uses SQLite FTS5. */
export function matchingMeetingIds(meetings: MeetingListItem[], query: string): string[] {
  const term = query.trim().toLowerCase()
  if (!term) return []
  return meetings
    .filter((meeting) => meeting.title.toLowerCase().includes(term) || (meeting.speakers ?? []).some((speaker) => speaker.name.toLowerCase().includes(term)))
    .map((meeting) => meeting.id)
}

export function meetingDurationLabel(meeting: MeetingListItem): string {
  if (!meeting.endedAt) return 'In progress'
  return durationLabel(meeting.startedAt, meeting.endedAt)
}

export function durationLabel(start: string, end: string): string {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim()
}

/** "Today", "Yesterday", "Tomorrow", or "Wednesday, September 30". */
export function dayLabel(iso: string, now = new Date()): string {
  const day = new Date(iso)
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(day.toDateString()).getTime()) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days === -1) return 'Tomorrow'
  return day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}
