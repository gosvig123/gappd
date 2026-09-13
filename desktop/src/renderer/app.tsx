import { useCallback, useMemo, useState } from 'react'
import type { MeetingDetail } from '../shared/contracts'
import type { SavedAgendaDraft } from '../shared/agenda-draft'
import type { CalendarEventSummary } from '../shared/calendar-contract'
import type { SavedPerson } from '../shared/participant-contract'
import { AppShell } from './components/app-shell'
import { useSavedDrafts, useSavedPeople } from './hooks/use-app-data'
import { useDashboardData } from './hooks/use-dashboard-data'
import { useGoogleCalendar } from './hooks/use-google-calendar'
import { useManagedRuntime } from './hooks/use-managed-runtime'
import { useMeetingDetails } from './hooks/use-meeting-details'
import { useMeetingEvents } from './hooks/use-meeting-events'
import { useSetupPermissions } from './hooks/use-setup-permissions'
import { useSlackConnection } from './hooks/use-slack-connection'
import { useTheme, type ThemeName } from './hooks/use-theme'
import { useUpdateStatus } from './hooks/use-update-status'
import type { AppActions, AppView } from './lib/app-view'

export function App() {
  const runtime = useManagedRuntime()
  const permissions = useSetupPermissions(true)
  const dashboard = useDashboardData(true)
  const calendar = useGoogleCalendar()
  const slack = useSlackConnection()
  const update = useUpdateStatus()
  const [theme, setTheme] = useTheme()
  const meetingDetails = useMeetingDetails(dashboard.meetings)
  const { events: meetingEvents, linkCalendar: linkMeetingCalendar } = useMeetingEvents(dashboard.meetings, calendar.snapshot)
  const [drafts, reloadDrafts] = useSavedDrafts()
  const people = useSavedPeople()
  const [dismissals, setDismissals] = useState<ReadonlySet<string>>(() => new Set<string>())
  const actions = useAppActions({ dashboard, permissions, calendar, update, runtime, reloadDrafts, setDismissals, setTheme, linkMeetingCalendar })
  const view = buildView({ dashboard, permissions, calendar, slack, update, runtime, meetingDetails, meetingEvents, people, drafts, theme, dismissals, actions })
  return <AppShell view={view} />
}

type Inputs = {
  dashboard: ReturnType<typeof useDashboardData>
  permissions: ReturnType<typeof useSetupPermissions>
  calendar: ReturnType<typeof useGoogleCalendar>
  slack: ReturnType<typeof useSlackConnection>
  update: ReturnType<typeof useUpdateStatus>
  runtime: ReturnType<typeof useManagedRuntime>
  meetingDetails: Map<string, MeetingDetail>
  meetingEvents: Map<string, CalendarEventSummary>
  people: SavedPerson[]
  drafts: SavedAgendaDraft[]
  theme: ThemeName
  dismissals: ReadonlySet<string>
  actions: AppActions
}

function buildView(input: Inputs): AppView {
  const { dashboard, permissions, calendar, slack, update, runtime } = input
  return {
    meetings: dashboard.meetings, meetingDetails: input.meetingDetails, meetingEvents: input.meetingEvents,
    people: input.people, drafts: input.drafts,
    selectedMeetingId: dashboard.selectedMeetingId, selectedMeeting: dashboard.selectedMeeting,
    selectedMeetingLoading: dashboard.selectedMeetingLoading, selectedMeetingError: dashboard.selectedMeetingError,
    transcript: dashboard.transcript,
    devices: dashboard.devices, device: dashboard.device, recording: dashboard.recording,
    canStart: dashboard.canStart, canStop: dashboard.canStop, bannerError: dashboard.bannerError,
    isPermissionError: dashboard.isPermissionError,
    recoveringStale: dashboard.recoveringStale, staleRecoveryNotice: dashboard.staleRecoveryNotice,
    permissionsReady: permissions.ready, permissionsBusy: permissions.state.status === 'checking',
    runtime: runtime.status, runtimeBusy: runtime.busy, runtimeLoading: runtime.loading,
    update: update.status, calendar: calendar.snapshot, calendarController: calendar,
    slackController: slack,
    calendarBusy: calendar.busy, calendarError: calendar.error,
    language: dashboard.language, theme: input.theme,
    alertDismissals: input.dismissals, actions: input.actions,
  }
}

type ActionInputs = Pick<Inputs, 'dashboard' | 'permissions' | 'calendar' | 'update' | 'runtime'> & {
  linkMeetingCalendar: AppActions['linkMeetingCalendar']
  reloadDrafts: () => void
  setDismissals: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void
  setTheme: (theme: ThemeName) => void
}

function useAppActions(input: ActionInputs): AppActions {
  const { dashboard, permissions, calendar, update, runtime, reloadDrafts, setDismissals, setTheme, linkMeetingCalendar } = input
  return useMemo(() => ({
    openMeeting: (id) => void dashboard.actions.loadMeeting(id),
    closeMeeting: dashboard.actions.clearSelectedMeeting,
    retryDiarization: dashboard.actions.retryDiarization,
    meetingUpdated: dashboard.actions.updateMeeting,
    deleteMeeting: dashboard.actions.deleteMeeting,
    setDevice: dashboard.actions.setDevice,
    start: (eventSourceId) => void dashboard.actions.start(eventSourceId),
    stop: () => void dashboard.actions.stop(),
    requestPermissions: () => void permissions.request(),
    openPermissionsSettings: dashboard.actions.openPermissionsSettings,
    setLanguage: dashboard.actions.setLanguage,
    setupRuntime: () => void runtime.prepare('setup'),
    repairRuntime: () => void runtime.prepare('repair'),
    syncCalendar: (id) => calendar.sync(id),
    syncAllCalendars: calendar.syncAll,
    connectCalendar: calendar.connect,
    disconnectCalendar: async (id) => { await calendar.disconnect(id); reloadDrafts() },
    ...updateActions(update),
    dismissAlert: (id) => setDismissals((current) => new Set([...current, id])),
    setTheme, linkMeetingCalendar,
  }), [dashboard.actions, permissions.request, calendar.sync, calendar.syncAll, calendar.connect, calendar.disconnect, update.downloadUpdate, update.installAndRestart, update.checkNow, update.openUpdatePage, runtime.prepare, reloadDrafts, setDismissals, setTheme, linkMeetingCalendar])
}

function updateActions(update: Inputs['update']) {
  return {
    downloadUpdate: async () => { await update.downloadUpdate() },
    installUpdate: async () => { await update.installAndRestart() },
    checkForUpdate: async () => { await update.checkNow() },
    openReleasePage: async () => { await update.openUpdatePage() },
  }
}
