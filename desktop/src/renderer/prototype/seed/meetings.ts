import type { MeetingDetail, MeetingListItem, MeetingSegment } from '../../../shared/contracts'
import type { CaptureStatusInfo, DiarizationInfo, MeetingSpeaker, ProcessingStatusInfo } from '../../../shared/generated/contracts'
import { BLUEPRINTS, type Blueprint } from './blueprints'
import { at, minutesLater } from './time'

const DEFAULT_TURN_SECONDS = 24

export type SeededMeetings = { list: MeetingListItem[]; details: Map<string, MeetingDetail> }

export function seedMeetings(): SeededMeetings {
  const details = BLUEPRINTS.map(toDetail)
  const list = details.map(toListItem).sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  return { list, details: new Map(details.map((detail) => [detail.id, detail])) }
}

function toDetail(blueprint: Blueprint): MeetingDetail {
  const startedAt = at(blueprint.dayOffset, blueprint.hour, blueprint.minute)
  const endedAt = minutesLater(startedAt, blueprint.minutes)
  const segments = toSegments(blueprint)
  return {
    id: blueprint.id,
    title: blueprint.title,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    status: toStatus(blueprint, startedAt),
    transcriptText: segments.length ? segments.map((segment) => `${segment.speaker}: ${segment.text}`).join('\n\n') : undefined,
    transcriptProvisional: blueprint.state === 'recording' || blueprint.state === 'processing',
    summary: blueprint.summary,
    speakers: toSpeakers(segments),
    summaryUpdating: false,
    segments,
    diarization: toDiarization(blueprint),
  }
}

function toStatus(blueprint: Blueprint, startedAt: Date) {
  const stamp = startedAt.toISOString()
  const capture: CaptureStatusInfo = { state: blueprint.captureState ?? 'captured', updatedAt: stamp, failureMessage: blueprint.state === 'failed' ? blueprint.failureMessage : undefined }
  const processing: ProcessingStatusInfo = { state: blueprint.processingState ?? (blueprint.state === 'completed' ? 'completed' : 'pending'), updatedAt: stamp, failureMessage: blueprint.state === 'failed' ? blueprint.failureMessage : undefined }
  return { state: blueprint.state, updatedAt: stamp, capture, processing }
}

function toDiarization(blueprint: Blueprint): DiarizationInfo {
  const state = blueprint.diarizationState ?? (blueprint.turns?.length ? 'completed' : 'not_requested')
  const speakerCount = blueprint.turns ? new Set(blueprint.turns.map(([speaker]) => speaker)).size : undefined
  return { state, error: blueprint.diarizationError, speakerCount: state === 'not_requested' ? undefined : speakerCount }
}

function toSegments(blueprint: Blueprint): MeetingSegment[] {
  return (blueprint.turns ?? []).map(([speaker, text], index) => ({
    id: `${blueprint.id}-seg-${index + 1}`,
    startSec: index * DEFAULT_TURN_SECONDS,
    endSec: (index + 1) * DEFAULT_TURN_SECONDS,
    speaker,
    speakerKey: speakerKey(speaker),
    text,
  }))
}

function toSpeakers(segments: MeetingSegment[]): MeetingSpeaker[] {
  const seen = new Map<string, MeetingSpeaker>()
  for (const segment of segments) {
    if (seen.has(segment.speakerKey)) continue
    seen.set(segment.speakerKey, { key: segment.speakerKey, name: segment.speaker, personId: `p-${segment.speakerKey}` })
  }
  return [...seen.values()]
}

export function speakerKey(speaker: string): string {
  return speaker.toLowerCase().replace(/[^a-z]+/g, '-')
}

function toListItem(detail: MeetingDetail): MeetingListItem {
  return {
    id: detail.id,
    title: detail.title,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    status: detail.status,
    hasTranscript: Boolean(detail.transcriptText),
    hasSummary: Boolean(detail.summary),
    searchText: [detail.speakers.map((speaker) => speaker.name).join(' '), detail.summary ?? '', detail.transcriptText ?? ''].join(' ').toLowerCase().slice(0, 4000),
  }
}
