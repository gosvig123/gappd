import type { MeetingListItem } from '../../shared/contracts'

const DAY_MS = 24 * 60 * 60 * 1000

type SearchHit = { meeting: MeetingListItem; field: string; excerpt: string }

type DetailLike = { summary?: string; transcriptText?: string; speakers: Array<{ name: string }> }

/** Meeting search: title, People, notes, and transcript text. */
export function searchMeetings(meetings: MeetingListItem[], details: Map<string, DetailLike>, query: string): SearchHit[] {
  const term = query.trim().toLowerCase()
  if (!term) return []
  return meetings.flatMap((meeting) => matchHit(meeting, details.get(meeting.id), term) ?? [])
}

function matchHit(meeting: MeetingListItem, detail: DetailLike | undefined, term: string): SearchHit | null {
  if (meeting.title.toLowerCase().includes(term)) return { meeting, field: 'Title', excerpt: '' }
  const person = detail?.speakers.find((speaker) => speaker.name.toLowerCase().includes(term))
  if (person) return { meeting, field: 'Speaker', excerpt: person.name }
  if (detail?.summary && plainText(detail.summary).toLowerCase().includes(term)) return { meeting, field: 'Notes', excerpt: excerpt(plainText(detail.summary), term, 62) }
  if (detail?.transcriptText && plainText(detail.transcriptText).toLowerCase().includes(term)) return { meeting, field: 'Transcript', excerpt: excerpt(plainText(detail.transcriptText), term, 62) }
  return null
}

/** Notes and transcripts are stored as prose and Markdown, so strip markers before showing an excerpt. */
function plainText(source: string): string {
  return source.replace(/[*_`#>]/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim()
}

function excerpt(source: string, term: string, radius = 64): string {
  const at = source.toLowerCase().indexOf(term)
  if (at < 0) return source.slice(0, radius * 2)
  const start = Math.max(0, at - radius)
  const text = source.slice(start, Math.min(source.length, at + term.length + radius)).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${text}${at + term.length + radius < source.length ? '…' : ''}`
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
