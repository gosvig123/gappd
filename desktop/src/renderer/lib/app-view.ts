import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { SavedAgendaDraft } from '../../shared/agenda-draft'
import type { Device, MeetingDetail, MeetingListItem, RecordingState, UpdateStatus } from '../../shared/contracts'
import type { ManagedRuntimeSnapshot } from '../../shared/managed-runtime'
import type { LinkCalendarInput, ParticipantContext, SavedPerson } from '../../shared/participant-contract'
import { meetingProgressLabel } from '../components/meeting-progress'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'
import type { SlackConnectionController } from '../hooks/use-slack-connection'
import type { ThemeName } from '../hooks/use-theme'

/**
 * Everything the shell renders, gathered once. Sections receive this object
 * instead of calling the data hooks themselves, so one Meeting refresh feeds
 * every surface at the same time.
 */
export type AppView = {
  meetings: MeetingListItem[]
  meetingDetails: Map<string, MeetingDetail>
  meetingEvents: Map<string, CalendarEventSummary>
  people: SavedPerson[]
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  selectedMeetingLoading: boolean
  selectedMeetingError: string | null
  transcript: string
  devices: Device[]
  device: number
  recording: RecordingState
  canStart: boolean
  canStop: boolean
  bannerError: string | null
  isPermissionError: boolean
  recoveringStale: boolean
  staleRecoveryNotice: string | null
  permissionsReady: boolean
  permissionsBusy: boolean
  runtime: ManagedRuntimeSnapshot | null
  runtimeLoading: boolean
  runtimeBusy: boolean
  update: UpdateStatus | null
  calendar: CalendarSnapshot | null
  calendarController: GoogleCalendarController
  slackController: SlackConnectionController
  calendarBusy: string | null
  calendarError: string | null
  drafts: SavedAgendaDraft[]
  language: string
  theme: ThemeName
  alertDismissals: ReadonlySet<string>
  actions: AppActions
}

export type AppActions = {
  openMeeting: (id: string) => void
  closeMeeting: () => void
  retryDiarization: (id: string) => Promise<void>
  meetingUpdated: (meeting: MeetingDetail) => void
  linkMeetingCalendar: (input: LinkCalendarInput) => Promise<ParticipantContext>
  deleteMeeting: (id: string) => Promise<void>
  setDevice: (device: number) => void
  start: (eventSourceId?: string) => void
  stop: () => void
  requestPermissions: () => void
  openPermissionsSettings: () => void
  setLanguage: (language: string) => void
  setupRuntime: () => void
  repairRuntime: () => void
  syncCalendar: (id: string) => Promise<void>
  syncAllCalendars: () => Promise<void>
  connectCalendar: () => Promise<void>
  disconnectCalendar: (id: string) => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  checkForUpdate: () => Promise<void>
  openReleasePage: () => Promise<void>
  dismissAlert: (id: string) => void
  setTheme: (theme: ThemeName) => void
}

export function upcomingEvents(calendar: CalendarSnapshot | null, limit = 6, now = new Date()): CalendarEventSummary[] {
  if (!calendar) return []
  return calendar.events
    .filter((event) => new Date(event.end).getTime() >= now.getTime())
    .sort((left, right) => left.start.localeCompare(right.start))
    .slice(0, limit)
}

/**
 * Upcoming events without a display limit. The Calendar section head and the
 * sidebar badge both count what the section covers, so they must agree.
 */
export function upcomingEventCount(calendar: CalendarSnapshot | null, now = new Date()): number {
  if (!calendar) return 0
  return calendar.events.filter((event) => new Date(event.end).getTime() >= now.getTime()).length
}

export function eventTimeRange(event: CalendarEventSummary): string {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const sameDay = start.toDateString() === end.toDateString()
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return sameDay ? `${day.format(start)} · ${time.format(start)}–${time.format(end)}` : `${day.format(start)} → ${day.format(end)}`
}

export function eventIsNow(event: CalendarEventSummary, now = new Date()): boolean {
  return new Date(event.start).getTime() <= now.getTime() && new Date(event.end).getTime() >= now.getTime()
}

/** One line describing what a Meeting has produced so far. */
export function artifactLine(meeting: MeetingListItem): string {
  if (meeting.status.state === 'recording') return 'Recording now · transcript follows after stop'
  if (meeting.status.processing.state === 'processing' && !meeting.hasTranscript) return 'Transcribing audio locally…'
  if (meeting.status.processing.state === 'processing' && !meeting.hasSummary) return 'Creating summary locally…'
  if (meeting.status.processing.state === 'processing') return 'Finalizing notes…'
  if (meeting.status.state === 'failed') return meeting.status.processing.failureMessage ?? meeting.status.capture.failureMessage ?? 'Recording failed'
  if (meeting.status.state === 'pending') return 'Audio captured · waiting to process'
  if (meeting.hasSummary && meeting.hasTranscript) return 'Notes and transcript available'
  if (meeting.hasSummary) return 'Notes available'
  if (meeting.hasTranscript) return 'Transcript available'
  return 'Artifacts pending'
}

export function statusLabel(meeting: MeetingListItem): string {
  return meetingProgressLabel(meeting)
}
