/** The Calendar model's title for an event without one. It never names a Meeting. */
export const UNTITLED_EVENT_TITLE = 'Untitled event'

const GENERATED_TITLE_MAX_CODEPOINTS = 80

/** The title a Calendar event gives its Meeting, or '' when the event has no real title. */
export function calendarMeetingTitle(eventTitle?: string): string {
  const title = eventTitle?.trim() ?? ''
  return title === UNTITLED_EVENT_TITLE ? '' : title
}

/**
 * Matches a Meeting title against saved Calendar event titles, including titles the backend
 * cleaned (`cleanGeneratedMeetingTitle` in internal/meetinglifecycle/title.go). Both sides are
 * compared by their words, so a cut that ends on a space still matches. Both sides also get a
 * JavaScript trim, so a title trimmed in the app still matches; that can only mask more.
 */
export function matchesCalendarTitle(meetingTitle: string, calendarTitles: string[]): boolean {
  const trimmed = meetingTitle.trim()
  const words = goFields(meetingTitle.trim())
  if (!trimmed || !words) return false
  for (const candidate of calendarTitles) {
    const raw = candidate.trim()
    if (!raw) continue
    if (raw === trimmed) return true
    const clean = goFields(cleanCalendarTitle(candidate).trim())
    if (clean && clean === words) return true
  }
  return false
}

// Go's unicode.IsSpace set, used by strings.TrimSpace and strings.Fields. It differs from
// JavaScript's \s: it includes U+0085 and excludes U+FEFF.
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000'
const GO_SPACE_RUN = new RegExp(`[${GO_SPACE}]+`, 'u')
const GO_EDGE_SPACE = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'gu')
const TITLE_QUOTES = /^["'“”‘’]+|["'“”‘’]+$/gu

/** The words of a title joined by one space, as Go's strings.Join(strings.Fields(title), " "). */
function goFields(title: string): string {
  return title.split(GO_SPACE_RUN).filter(Boolean).join(' ')
}

/** Mirrors Go's cleanGeneratedMeetingTitle, without its generic-title check. */
function cleanCalendarTitle(title: string): string {
  const fields = goFields(title.replace(GO_EDGE_SPACE, '').replace(TITLE_QUOTES, ''))
  return [...fields].slice(0, GENERATED_TITLE_MAX_CODEPOINTS).join('')
}

/** The readable title of a Meeting without a Calendar event, such as "Meeting · Mon 9:08 AM". */
export function genericMeetingTitle(at: Date): string {
  return `Meeting · ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(at)}`
}
