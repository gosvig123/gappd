/** The Calendar model's title for an event without one. It never names a Meeting. */
export const UNTITLED_EVENT_TITLE = 'Untitled event'

/** The title a Calendar event gives its Meeting, or '' when the event has no real title. */
export function calendarMeetingTitle(eventTitle?: string): string {
  const title = eventTitle?.trim() ?? ''
  return title === UNTITLED_EVENT_TITLE ? '' : title
}

/** The readable title of a Meeting without a Calendar event, such as "Meeting · Mon 9:08 AM". */
export function genericMeetingTitle(at: Date): string {
  return `Meeting · ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(at)}`
}
