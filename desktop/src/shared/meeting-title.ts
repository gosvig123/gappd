/** The readable title of a Meeting without a Calendar event, such as "Meeting · Mon 9:08 AM". */
export function genericMeetingTitle(at: Date): string {
  return `Meeting · ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(at)}`
}
