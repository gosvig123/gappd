import type { CalendarSnapshot } from '../../../shared/calendar-contract'
import type { SavedAgendaDraft } from '../../../shared/agenda-draft'
import type { Device, MeetingDetail, RecordingState, UpdateStatus } from '../../../shared/contracts'
import type { ManagedRuntimeSnapshot } from '../../../shared/managed-runtime'
import type { AIProviderStatus, CapturePermissions, CodexModelCatalog, StartupSettings } from '../../../shared/ipc-contract'
import type { SavedPerson } from '../../../shared/participant-contract'
import { seedAgendaDrafts, seedCalendar } from '../seed/calendar'
import { seedMeetings } from '../seed/meetings'
import { SEED_DEVICES, SEED_PEOPLE, SEED_STARTUP, seedRecording, seedRuntime, seedUpdateStatus } from '../seed/misc'

export type Store = {
  devices: Device[]
  people: SavedPerson[]
  meetings: MeetingDetail[]
  trash: Map<string, MeetingDetail>
  recording: RecordingState
  recorder: Set<(state: RecordingState) => void>
  runtime: ManagedRuntimeSnapshot
  runtimeWatchers: Set<(snapshot: ManagedRuntimeSnapshot) => void>
  update: UpdateStatus
  updateWatchers: Set<(status: UpdateStatus) => void>
  calendar: CalendarSnapshot
  drafts: SavedAgendaDraft[]
  startup: StartupSettings
  permissions: CapturePermissions
  aiProvider: AIProviderStatus
  liveMeetingId: string | null
}

export function createStore(): Store {
  const calendar = seedCalendar()
  const { list, details } = seedMeetings()
  return {
    devices: SEED_DEVICES,
    people: SEED_PEOPLE,
    meetings: list.map((item) => details.get(item.id)).filter(Boolean) as MeetingDetail[],
    trash: new Map(),
    recording: seedRecording(),
    recorder: new Set(),
    runtime: seedRuntime(),
    runtimeWatchers: new Set(),
    update: seedUpdateStatus(),
    updateWatchers: new Set(),
    calendar,
    drafts: seedAgendaDrafts(calendar.events),
    startup: { ...SEED_STARTUP },
    permissions: { microphone: 'granted', screen: 'granted' },
    aiProvider: { provider: 'local', codexExecutable: '/opt/homebrew/bin/codex', codexModel: 'gpt-5.1-codex', codexReasoningEffort: 'medium', available: true },
    liveMeetingId: null,
  }
}

export const CODEX_CATALOG: CodexModelCatalog = {
  models: [
    { id: 'gpt-5.1-codex', displayName: 'GPT-5.1 Codex', defaultReasoningEffort: 'medium', reasoningEfforts: ['low', 'medium', 'high'], isDefault: true },
    { id: 'gpt-5.1-codex-mini', displayName: 'GPT-5.1 Codex mini', defaultReasoningEffort: 'low', reasoningEfforts: ['low', 'medium'], isDefault: false },
  ],
  defaultModel: 'gpt-5.1-codex',
  defaultReasoningEffort: 'medium',
}

export function emitRecording(store: Store, state: RecordingState): void {
  store.recording = state
  for (const listener of store.recorder) listener(state)
}

export function emitRuntime(store: Store, snapshot: ManagedRuntimeSnapshot): void {
  store.runtime = snapshot
  for (const listener of store.runtimeWatchers) listener(snapshot)
}

export function emitUpdate(store: Store, status: UpdateStatus): void {
  store.update = status
  for (const listener of store.updateWatchers) listener(status)
}
