import type { MeetingListItem } from '../../shared/contracts'
import { artifactLine } from './contract'

export type MeetingGroup = { key: 'today' | 'week' | 'earlier'; title: string; meetings: MeetingListItem[] }

const DAY_MS = 24 * 60 * 60 * 1000
const GROUP_TITLES = { today: 'Today', week: 'Last 7 days', earlier: 'Earlier' } as const

export function groupByDate(meetings: MeetingListItem[], now = new Date()): MeetingGroup[] {
  const buckets: Record<MeetingGroup['key'], MeetingListItem[]> = { today: [], week: [], earlier: [] }
  for (const meeting of meetings) buckets[bucketOf(meeting, now)].push(meeting)
  return (['today', 'week', 'earlier'] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, title: GROUP_TITLES[key], meetings: buckets[key] }))
}

function bucketOf(meeting: MeetingListItem, now: Date): MeetingGroup['key'] {
  const startedAt = new Date(meeting.startedAt).getTime()
  if (!Number.isFinite(startedAt)) return 'earlier'
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (startedAt >= todayStart && startedAt < todayStart + DAY_MS) return 'today'
  if (startedAt >= todayStart - 7 * DAY_MS) return 'week'
  return 'earlier'
}

export type SearchHit = { meeting: MeetingListItem; reason: string }

/** Meeting search: title, People, summary, and transcript text. */
export function searchMeetings(meetings: MeetingListItem[], details: Map<string, { summary?: string; transcriptText?: string; speakers: Array<{ name: string }> }>, query: string): SearchHit[] {
  const term = query.trim().toLowerCase()
  if (!term) return []
  return meetings
    .map((meeting) => ({ meeting, reason: matchReason(meeting, details.get(meeting.id), term) }))
    .filter((hit): hit is SearchHit => Boolean(hit.reason))
}

function matchReason(meeting: MeetingListItem, detail: { summary?: string; transcriptText?: string; speakers: Array<{ name: string }> } | undefined, term: string): string | null {
  if (meeting.title.toLowerCase().includes(term)) return 'Title'
  const person = detail?.speakers.find((speaker) => speaker.name.toLowerCase().includes(term))
  if (person) return `Speaker · ${person.name}`
  if (detail?.summary?.toLowerCase().includes(term)) return `Notes · ${excerpt(detail.summary, term)}`
  if (detail?.transcriptText?.toLowerCase().includes(term)) return `Transcript · ${excerpt(detail.transcriptText, term)}`
  return null
}

export function excerpt(source: string, term: string, radius = 64): string {
  const at = source.toLowerCase().indexOf(term)
  if (at < 0) return source.slice(0, radius * 2)
  const start = Math.max(0, at - radius)
  const text = source.slice(start, Math.min(source.length, at + term.length + radius)).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${text}${at + term.length + radius < source.length ? '…' : ''}`
}

export function meetingDurationLabel(meeting: MeetingListItem): string {
  if (!meeting.endedAt) return 'In progress'
  const minutes = Math.round((new Date(meeting.endedAt).getTime() - new Date(meeting.startedAt).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim()
}

export function meetingTimeLabel(meeting: MeetingListItem): string {
  const started = new Date(meeting.startedAt)
  const now = new Date()
  const sameDay = started.toDateString() === now.toDateString()
  const time = started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${started.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`
}

export function meetingSummaryLine(meeting: MeetingListItem): string {
  return artifactLine(meeting)
}
