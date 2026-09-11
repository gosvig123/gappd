import type { MeetingDetail, MeetingListItem } from '../../../shared/contracts'
import type { GappdApi } from '../../../shared/ipc-contract'
import type { ParticipantContext } from '../../../shared/participant-contract'
import { calendarEventIsUpcoming } from '../../../shared/meeting-agenda'
import { SEED_MEETING_EVENT_LINKS } from '../seed/misc'
import { emitRecording, type Store } from './store'
import { toneClip } from './wav'

export function systemApi(store: Store): GappdApi['system'] {
  return {
    getDevices: async () => store.devices,
    requestCapturePermissions: async () => store.permissions,
    openPermissionsSettings: async () => undefined,
    startStaleRecordingRecovery: async () => 0,
  }
}

export function meetingsApi(store: Store): GappdApi['meetings'] {
  const links = seedLinks(store)
  return {
    list: async () => store.meetings.map(toListItem).sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    show: async (id) => requireMeeting(store, id),
    retryDiarization: async (id) => update(store, id, (meeting) => ({ ...meeting, diarization: { ...meeting.diarization, state: 'completed', error: undefined } })),
    delete: async (id) => remove(store, id),
    people: async () => store.people,
    assignSpeaker: async (input) => assign(store, input),
    speakerClip: async () => ({ ...toneClip(), text: 'Speaker preview', startSec: 0 }),
    participantContext: async (id) => context(store, links, id),
    linkCalendar: async (input) => { links.set(input.id, input.eventSourceId); return context(store, links, input.id) },
  }
}

export function recordingApi(store: Store): GappdApi['recording'] {
  return {
    getStatus: async () => store.recording,
    start: async (input) => startRecording(store, input.device ?? 0, input.eventSourceId),
    stop: async () => stopRecording(store),
    onStatusChanged: (listener) => { store.recorder.add(listener); return () => store.recorder.delete(listener) },
  }
}

function startRecording(store: Store, device: number, eventSourceId?: string) {
  const event = eventSourceId ? store.calendar.events.find((item) => item.sourceId === eventSourceId) : undefined
  const meeting: MeetingDetail = {
    id: `m-live-${Date.now()}`, title: event?.title ?? 'New meeting', startedAt: new Date().toISOString(),
    status: { state: 'recording', updatedAt: new Date().toISOString(), capture: { state: 'recording', updatedAt: new Date().toISOString() }, processing: { state: 'pending', updatedAt: new Date().toISOString() } },
    transcriptText: '', transcriptProvisional: true, speakers: [], summaryUpdating: false, segments: [], diarization: { state: 'pending' },
  }
  store.meetings.unshift(meeting)
  store.liveMeetingId = meeting.id
  emitRecording(store, { status: 'recording', meetingId: meeting.id, title: meeting.title })
  void device
  return store.recording
}

function stopRecording(store: Store) {
  const id = store.liveMeetingId
  emitRecording(store, { status: 'stopping', meetingId: id ?? undefined })
  window.setTimeout(() => {
    if (id) update(store, id, (meeting) => ({ ...meeting, status: { ...meeting.status, state: 'processing', processing: { state: 'processing', updatedAt: new Date().toISOString() } } }))
    store.liveMeetingId = null
    emitRecording(store, { status: 'idle', meetingId: id ?? undefined })
  }, 900)
  return store.recording
}

function requireMeeting(store: Store, id: string): MeetingDetail {
  const meeting = store.meetings.find((item) => item.id === id)
  if (!meeting) throw new Error(`Meeting ${id} is not available.`)
  return meeting
}

function update(store: Store, id: string, change: (meeting: MeetingDetail) => MeetingDetail): MeetingDetail {
  const next = change(requireMeeting(store, id))
  store.meetings = store.meetings.map((meeting) => (meeting.id === id ? next : meeting))
  return next
}

function remove(store: Store, id: string): { deletedId: string } {
  const meeting = requireMeeting(store, id)
  store.trash.set(id, meeting)
  store.meetings = store.meetings.filter((item) => item.id !== id)
  return { deletedId: id }
}

function assign(store: Store, input: { id: string; speakerKey: string; personId?: string; name?: string; email?: string }): MeetingDetail {
  return update(store, input.id, (meeting) => {
    const name = input.name || input.personId || input.speakerKey
    return {
      ...meeting,
      speakers: meeting.speakers.map((speaker) => (speaker.key === input.speakerKey ? { ...speaker, name, personId: input.personId } : speaker)),
      segments: meeting.segments.map((segment) => (segment.speakerKey === input.speakerKey ? { ...segment, speaker: name } : segment)),
    }
  })
}

function context(store: Store, links: Map<string, string>, id: string): ParticipantContext {
  const linked = links.get(id)
  const event = linked ? store.calendar.events.find((item) => item.sourceId === linked) : undefined
  const candidates = store.calendar.events.filter((item) => calendarEventIsUpcoming(item) || item.sourceId === linked)
  return { event, candidates, inferenceDisabled: false }
}

/** Resolves the seeded Meeting to event ids against the seeded events. */
function seedLinks(store: Store): Map<string, string> {
  const links = new Map<string, string>()
  for (const [meetingId, eventId] of Object.entries(SEED_MEETING_EVENT_LINKS)) {
    const event = store.calendar.events.find((item) => item.eventId === eventId)
    if (event) links.set(meetingId, event.sourceId)
  }
  return links
}

function toListItem(detail: MeetingDetail): MeetingListItem {
  return {
    id: detail.id, title: detail.title, startedAt: detail.startedAt, endedAt: detail.endedAt,
    status: detail.status, hasTranscript: Boolean(detail.transcriptText), hasSummary: Boolean(detail.summary),
    searchText: [detail.speakers.map((speaker) => speaker.name).join(' '), detail.summary ?? '', detail.transcriptText ?? ''].join(' ').toLowerCase(),
  }
}
