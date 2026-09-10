import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDashboardData } from '../hooks/use-dashboard-data'
import { useGoogleCalendar } from '../hooks/use-google-calendar'
import { useManagedRuntime } from '../hooks/use-managed-runtime'
import { useSetupPermissions } from '../hooks/use-setup-permissions'
import { useUpdateStatus } from '../hooks/use-update-status'
import type { PrototypeActions, PrototypeView, ThemeName } from './contract'
import { PrototypeSwitcher } from './switcher'
import { readParam, writeParams } from './url-params'
import { useMeetingDetails } from './use-meeting-details'
import { useSavedDrafts, useSavedPeople } from './use-prototype-data'
import { VARIANTS } from './variants'

/**
 * PROTOTYPE. Throwaway code for judging an overhauled Gappd UI.
 *
 * The real data layer (dashboard, Calendar, runtime, update, permissions) sits
 * here, above the switcher. Only the rendered shell swaps per variant, so every
 * variant is judged against the same real behaviour and the same seeded states.
 */
export function PrototypeApp() {
  const runtime = useManagedRuntime()
  const permissions = useSetupPermissions(true)
  const dashboard = useDashboardData(true)
  const calendar = useGoogleCalendar()
  const update = useUpdateStatus()
  const meetingDetails = useMeetingDetails(dashboard.meetings)
  const [drafts, reloadDrafts] = useSavedDrafts()
  const people = useSavedPeople()
  const [theme, setTheme] = useState<ThemeName>(() => (readParam('theme') === 'light' ? 'light' : 'dark'))
  const [dismissals, setDismissals] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [variantKey, setVariantKey] = useState(() => readParam('variant') ?? VARIANTS[0]?.key ?? '')
  useThemeAttribute(theme)
  const selectVariant = useCallback((key: string) => { setVariantKey(key); writeParams({ variant: key }) }, [])
  const toggleTheme = useCallback(() => setTheme((value) => { const next = value === 'dark' ? 'light' : 'dark'; writeParams({ theme: next }); return next }), [])
  const actions = usePrototypeActions(dashboard, permissions, calendar, update, reloadDrafts, setDismissals, setTheme, runtime)
  const view: PrototypeView = {
    meetings: dashboard.meetings, meetingDetails, people,
    selectedMeetingId: dashboard.selectedMeetingId, selectedMeeting: dashboard.selectedMeeting,
    selectedMeetingLoading: dashboard.selectedMeetingLoading, selectedMeetingError: dashboard.selectedMeetingError,
    transcript: dashboard.transcript,
    devices: dashboard.devices, device: dashboard.device, recording: dashboard.recording,
    canStart: dashboard.canStart, canStop: dashboard.canStop, bannerError: dashboard.bannerError,
    permissionsReady: permissions.ready, permissionsBusy: permissions.state.status === 'checking',
    runtime: runtime.status, runtimeBusy: runtime.busy, runtimeLoading: runtime.loading,
    update: update.status, calendar: calendar.snapshot, calendarController: calendar,
    calendarBusy: calendar.busy, calendarError: calendar.error,
    drafts, language: dashboard.language, theme, alertDismissals: dismissals, actions,
  }
  const current = VARIANTS.find((variant) => variant.key === variantKey) ?? VARIANTS[0]
  if (!current) return null
  return (
    <>
      <current.Component view={view} />
      <PrototypeSwitcher variants={VARIANTS} current={current} theme={theme} onSelect={selectVariant} onToggleTheme={toggleTheme} />
    </>
  )
}

function usePrototypeActions(
  dashboard: ReturnType<typeof useDashboardData>,
  permissions: ReturnType<typeof useSetupPermissions>,
  calendar: ReturnType<typeof useGoogleCalendar>,
  update: ReturnType<typeof useUpdateStatus>,
  reloadDrafts: () => void,
  setDismissals: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
  setTheme: (theme: ThemeName) => void,
  runtime: ReturnType<typeof useManagedRuntime>,
): PrototypeActions {
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
    repairRuntime: (mode) => void runtime.prepare(mode),
    syncCalendar: (id) => calendar.sync(id),
    syncAllCalendars: calendar.syncAll,
    connectCalendar: calendar.connect,
    disconnectCalendar: async (id) => { await calendar.disconnect(id); reloadDrafts() },
    downloadUpdate: async () => { await update.downloadUpdate() },
    installUpdate: async () => { await update.installAndRestart() },
    dismissAlert: (id) => setDismissals((current) => new Set([...current, id])),
    setTheme: (next) => { writeParams({ theme: next }); setTheme(next) },
  }), [dashboard.actions, permissions.request, calendar.sync, calendar.syncAll, calendar.connect, calendar.disconnect, update.downloadUpdate, update.installAndRestart, runtime.prepare, reloadDrafts, setDismissals, setTheme])
}

function useThemeAttribute(theme: ThemeName): void {
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
}
