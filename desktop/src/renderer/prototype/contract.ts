import type { CalendarEventSummary, CalendarSnapshot } from '../../shared/calendar-contract'
import type { SavedAgendaDraft } from '../../shared/agenda-draft'
import type { Device, MeetingDetail, MeetingListItem, RecordingState, UpdateStatus } from '../../shared/contracts'
import type { ManagedRuntimeSnapshot } from '../../shared/managed-runtime'
import type { SavedPerson } from '../../shared/participant-contract'
import { meetingProgressLabel } from '../components/meeting-progress'
import type { GoogleCalendarController } from '../hooks/use-google-calendar'

export type ThemeName = 'dark' | 'light'

export type AlertKind = 'blocking' | 'attention' | 'info'

export type AlertItem = {
  id: string
  kind: AlertKind
  title: string
  detail?: string
  actionLabel?: string
  run?: () => void
  dismiss?: () => void
}

export type PrototypeView = {
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
  permissionsReady: boolean
  permissionsBusy: boolean
  runtime: ManagedRuntimeSnapshot | null
  runtimeBusy: boolean
  update: UpdateStatus | null
  calendar: CalendarSnapshot | null
  calendarController: GoogleCalendarController
  calendarBusy: string | null
  calendarError: string | null
  drafts: SavedAgendaDraft[]
  language: string
  runtimeLoading: boolean
  theme: ThemeName
  alertDismissals: ReadonlySet<string>
  actions: PrototypeActions
}

export type PrototypeActions = {
  openMeeting: (id: string) => void
  closeMeeting: () => void
  retryDiarization: (id: string) => Promise<void>
  meetingUpdated: (meeting: MeetingDetail) => void
  deleteMeeting: (id: string) => Promise<void>
  setDevice: (device: number) => void
  start: (eventSourceId?: string) => void
  stop: () => void
  requestPermissions: () => void
  openPermissionsSettings: () => void
  setLanguage: (language: string) => void
  repairRuntime: (mode: 'setup' | 'repair') => void
  syncCalendar: (id: string) => Promise<void>
  syncAllCalendars: () => Promise<void>
  connectCalendar: () => Promise<void>
  disconnectCalendar: (id: string) => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  dismissAlert: (id: string) => void
  setTheme: (theme: ThemeName) => void
}

export function buildAlerts(view: PrototypeView): AlertItem[] {
  const items: AlertItem[] = []
  if (!view.permissionsReady) items.push({ id: 'permissions', kind: 'blocking', title: 'Recording access is not ready', detail: 'Gappd needs microphone and screen/system audio access before the first recording.', actionLabel: view.permissionsBusy ? 'Checking…' : 'Allow access', run: view.actions.requestPermissions })
  if (view.bannerError) items.push({ id: 'error', kind: 'attention', title: 'Something needs attention', detail: view.bannerError, actionLabel: 'Open System Settings', run: view.actions.openPermissionsSettings })
  if (view.runtime?.operation === 'error') items.push({ id: 'runtime-error', kind: 'attention', title: 'Local AI runtime needs repair', detail: view.runtime.message })
  if (view.runtime && view.runtime.operation !== 'ready' && view.runtime.operation !== 'error') items.push({ id: 'runtime-busy', kind: 'info', title: 'Preparing local AI', detail: view.runtime.message })
  const brokenConnection = view.calendar?.connections.find((connection) => connection.status === 'error')
  if (brokenConnection) items.push({ id: `calendar-${brokenConnection.id}`, kind: 'attention', title: `${brokenConnection.email} needs reconnecting`, detail: brokenConnection.error, actionLabel: 'Reconnect', run: () => void view.actions.connectCalendar() })
  if (view.calendarError) items.push({ id: 'calendar-error', kind: 'attention', title: 'Calendar refresh failed', detail: view.calendarError, actionLabel: 'Try again', run: () => void view.actions.syncAllCalendars() })
  if (view.update?.available) items.push({ id: 'update', kind: 'info', title: `Gappd ${view.update.latestVersion ?? ''} is ready to install`.replace('  ', ' '), detail: `You are on ${view.update.currentVersion}. Installing restarts Gappd.`, actionLabel: updateActionLabel(view.update), run: () => void (view.update?.phase === 'downloaded' ? view.actions.installUpdate() : view.actions.downloadUpdate()) })
  if (view.selectedMeetingError) items.push({ id: 'meeting-error', kind: 'attention', title: 'Could not open that Meeting', detail: view.selectedMeetingError })
  return items.filter((item) => !view.alertDismissals.has(item.id))
}

export function updateActionLabel(status: UpdateStatus): string {
  if (status.phase === 'downloaded') return 'Restart and install'
  if (status.phase === 'downloading') return `Downloading ${status.progress ?? 0}%`
  if (status.phase === 'installing') return 'Installing…'
  return 'Download update'
}

export function dismissibleAlerts(alerts: AlertItem[]): AlertItem[] {
  return alerts.filter((alert) => alert.kind !== 'blocking')
}

export function upcomingEvents(calendar: CalendarSnapshot | null, limit = 6, now = new Date()): CalendarEventSummary[] {
  if (!calendar) return []
  return calendar.events.filter((event) => new Date(event.end).getTime() >= now.getTime()).sort((left, right) => left.start.localeCompare(right.start)).slice(0, limit)
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
