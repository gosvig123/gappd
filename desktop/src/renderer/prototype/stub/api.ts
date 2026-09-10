import type { GappdApi } from '../../../shared/ipc-contract'
import { agendaApi, aiProviderApi, googleCalendarApi, runtimeApi, startupApi, updateApi } from './api-runtime'
import { meetingsApi, recordingApi, systemApi } from './api-meetings'
import { createStore } from './store'

/**
 * Prototype-only `window.gappd`. Seeded, in memory, and never persisted, so the
 * variants exercise real loading and error paths without touching the user's
 * Meeting database.
 */
export function installStubApi(): void {
  const store = createStore()
  const api: GappdApi = {
    system: systemApi(store),
    meetings: meetingsApi(store),
    recording: recordingApi(store),
    managedRuntime: runtimeApi(store),
    aiProvider: aiProviderApi(store),
    agenda: agendaApi(store),
    googleCalendar: googleCalendarApi(store),
    update: updateApi(store),
    startup: startupApi(store),
  }
  Object.defineProperty(window, 'gappd', { value: api, configurable: true })
}
