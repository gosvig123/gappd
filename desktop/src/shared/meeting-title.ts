/** The Calendar model's title for an event without one. It never names a Meeting. */
export const UNTITLED_EVENT_TITLE = 'Untitled event'

const GENERATED_TITLE_MAX_CODEPOINTS = 80

/** The title a Calendar event gives its Meeting, or '' when the event has no real title. */
export function calendarMeetingTitle(eventTitle?: string): string {
  const title = eventTitle?.trim() ?? ''
  return title === UNTITLED_EVENT_TITLE ? '' : title
}

/** Matches a Meeting title against saved Calendar event titles, including backend-normalized titles. */
export function matchesCalendarTitle(meetingTitle: string, calendarTitles: string[]): boolean {
  const trimmed = meetingTitle.trim()
  if (!trimmed) return false
  const normalized = normalizeCalendarTitle(trimmed)
  for (const candidate of calendarTitles) {
    const raw = candidate.trim()
    if (!raw) continue
    if (raw === trimmed) return true
    const clean = normalizeCalendarTitle(raw)
    if (clean && clean === normalized) return true
  }
  return false
}

function normalizeCalendarTitle(title: string): string {
  const stripped = title.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  const collapsed = stripped.replace(/\s+/g, ' ')
  return [...collapsed].slice(0, GENERATED_TITLE_MAX_CODEPOINTS).join('')
}

/** The readable title of a Meeting without a Calendar event, such as "Meeting · Mon 9:08 AM". */
export function genericMeetingTitle(at: Date): string {
  return `Meeting · ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(at)}`
}
