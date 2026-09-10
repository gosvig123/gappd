import type { SavedAgendaDraft, GeneratedAgenda } from '../../../shared/agenda-draft'
import { agendaDraftKey } from '../../../shared/agenda-draft'
import type { GappdApi } from '../../../shared/ipc-contract'
import { CODEX_CATALOG, emitRuntime, emitUpdate, type Store } from './store'

export function runtimeApi(store: Store): GappdApi['managedRuntime'] {
  return {
    status: async () => store.runtime,
    prepare: async (input) => {
      emitRuntime(store, { ...store.runtime, operation: input.mode === 'repair' ? 'saving_config' : 'starting_runtime', message: input.mode === 'repair' ? 'Repairing the managed local runtime…' : 'Preparing the managed local runtime…', progress: 0 })
      await wait(1400)
      emitRuntime(store, { ...store.runtime, operation: 'ready', message: 'Local AI is ready. Transcript text and audio stay on this Mac.', progress: undefined })
      return store.runtime
    },
    observe: (listener) => { store.runtimeWatchers.add(listener); return () => store.runtimeWatchers.delete(listener) },
  }
}

export function aiProviderApi(store: Store): GappdApi['aiProvider'] {
  return {
    status: async () => store.aiProvider,
    models: async () => CODEX_CATALOG,
    useLocal: async () => { store.aiProvider = { ...store.aiProvider, provider: 'local', available: true, error: undefined }; return store.aiProvider },
    configureCodex: async (input) => {
      const known = CODEX_CATALOG.models.some((model) => model.id === input.model)
      store.aiProvider = { provider: 'codex_exec', codexExecutable: input.executable, codexModel: input.model, codexReasoningEffort: input.reasoningEffort, available: known, error: known ? undefined : 'Selected model is not in the installed Codex catalog.' }
      return store.aiProvider
    },
  }
}

export function updateApi(store: Store): GappdApi['update'] {
  return {
    getStatus: async () => store.update,
    checkNow: async () => { emitUpdate(store, { ...store.update, phase: 'checking' }); await wait(700); emitUpdate(store, { ...store.update, phase: 'available', available: true }); return store.update },
    downloadUpdate: async () => {
      for (const progress of [12, 38, 64, 88, 100]) {
        emitUpdate(store, { ...store.update, phase: 'downloading', progress })
        await wait(420)
      }
      emitUpdate(store, { ...store.update, phase: 'downloaded', progress: undefined })
      return store.update
    },
    installAndRestart: async () => { emitUpdate(store, { ...store.update, phase: 'installing' }); return store.update },
    openUpdatePage: async () => undefined,
    onStatusChanged: (listener) => { store.updateWatchers.add(listener); return () => store.updateWatchers.delete(listener) },
  }
}

export function startupApi(store: Store): GappdApi['startup'] {
  return {
    getSettings: async () => store.startup,
    setOpenAtLogin: async (openAtLogin) => { store.startup = { ...store.startup, openAtLogin }; return store.startup },
    setSpeakerLabelsEnabled: async (speakerLabelsEnabled) => { store.startup = { ...store.startup, speakerLabelsEnabled }; return store.startup },
  }
}

export function agendaApi(store: Store): GappdApi['agenda'] {
  return {
    load: async (draftKey) => store.drafts.find((draft) => draft.draftKey === draftKey) ?? null,
    list: async () => store.drafts,
    save: async (input) => {
      const draft = store.drafts.find((item) => item.draftKey === input.draftKey)
      if (!draft) return { ok: false, reason: 'missing', draftKey: input.draftKey, revision: 0, durable: false }
      const next = applyTopics(draft, input.topics)
      store.drafts = store.drafts.map((item) => (item.draftKey === input.draftKey ? next : item))
      return { ok: true, draftKey: next.draftKey, revision: next.revision, durable: true, current: next }
    },
    remove: async (draftKey) => { store.drafts = store.drafts.filter((draft) => draft.draftKey !== draftKey); return { removed: true } },
  }
}

export function googleCalendarApi(store: Store): GappdApi['googleCalendar'] {
  return {
    snapshot: async () => store.calendar,
    connect: async () => { store.calendar = { ...store.calendar, connections: [...store.calendar.connections, { id: `conn-${Date.now()}`, email: 'krisitan@studio.example', status: 'ready', lastSyncedAt: new Date().toISOString() }] }; return store.calendar },
    sync: async (connectionId) => { store.calendar = { ...store.calendar, connections: store.calendar.connections.map((item) => (item.id === connectionId ? { ...item, status: 'ready', error: undefined, lastSyncedAt: new Date().toISOString() } : item)) }; return store.calendar },
    disconnect: async (connectionId) => { store.calendar = { ...store.calendar, connections: store.calendar.connections.filter((item) => item.id !== connectionId) }; return store.calendar },
    generateAgenda: async (input) => generate(store, input.sourceId),
  }
}

function applyTopics(draft: SavedAgendaDraft, topics: string[]): SavedAgendaDraft {
  const items = topics.map((topic) => draft.items.find((item) => item.topic === topic) ?? { topic, sourceId: draft.sources[0]?.id ?? '', quote: draft.sources[0] ? 'Reopened from local Meeting history.' : '' })
  return { ...draft, items, updatedAt: new Date().toISOString(), revision: draft.revision + 1, durable: true }
}

function generate(store: Store, sourceId: string): GeneratedAgenda {
  const event = store.calendar.events.find((item) => item.sourceId === sourceId)
  if (!event) return { sourceId, draftKey: '', draft: null, saved: false, durable: false, conflict: false, revision: 0, generatedAt: new Date().toISOString(), model: store.aiProvider.codexModel, reasoningEffort: store.aiProvider.codexReasoningEffort, error: 'Calendar event is not available.' }
  const sources = store.meetings.filter((meeting) => meeting.transcriptText).slice(0, 3)
  const topics = ['Confirm status of open decisions from the last planning session', 'Review what changed since the previous Meeting', `Prepare open questions for ${event.attendees?.[0]?.name ?? 'the attendees'}`]
  const draft = { draftKey: draftKeyOf(event), sourceId, title: event.title, accountEmail: event.accountEmail, eventStart: event.start, eventEnd: event.end, items: topics.map((topic, index) => ({ topic, sourceId: sources[index]?.id ?? '', quote: sources[index]?.segments[0]?.text ?? '' })), sources: sources.map((meeting) => ({ id: meeting.id, title: meeting.title, startedAt: meeting.startedAt })), historyIncomplete: false, generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: store.aiProvider.provider === 'local' ? 'local-ai' : store.aiProvider.codexModel, reasoningEffort: store.aiProvider.codexReasoningEffort, revision: 1, durable: true }
  store.drafts = [...store.drafts.filter((item) => item.draftKey !== draft.draftKey), draft]
  return { sourceId, draftKey: draft.draftKey, draft: { items: draft.items, sources: draft.sources, historyIncomplete: false }, saved: true, durable: true, conflict: false, revision: 1, generatedAt: draft.generatedAt, model: draft.model, reasoningEffort: draft.reasoningEffort }
}

function draftKeyOf(event: { accountEmail: string; calendarId: 'primary'; eventId: string }): string {
  return agendaDraftKey(event)
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
