import { useMemo, useState } from 'react'
import type { MeetingSegment } from '../../shared/contracts'
import { Button } from '../components/ui'
import './transcript-view.css'

const ALL_SPEAKERS = 'All'
const EMPTY_FILTER_TEXT = 'No transcript lines for this speaker yet.'
const SPEAKER_LINE_PATTERN = /^\[([^\]]+)\]\s*(.*)$/

type TranscriptGroup = { speaker: string | null; lines: string[] }

export function TranscriptText({ value, segments }: { value: string; segments: MeetingSegment[] }) {
  if (segments.length > 0) return <TranscriptSegments segments={segments} />
  return <div className="transcript-groups">{transcriptGroups(value).map((group, index) => <TranscriptGroupView key={index} group={group} />)}</div>
}

function TranscriptSegments({ segments }: { segments: MeetingSegment[] }) {
  const [speaker, setSpeaker] = useState(ALL_SPEAKERS)
  const speakers = useMemo(() => transcriptSpeakers(segments), [segments])
  const visible = visibleTranscriptSegments(segments, speaker)
  return <div className="transcript-segment-view"><SpeakerFilter speakers={speakers} speaker={speaker} onSpeaker={setSpeaker} /><TranscriptSegmentList segments={visible} /></div>
}

function SpeakerFilter({ speakers, speaker, onSpeaker }: { speakers: string[]; speaker: string; onSpeaker: (speaker: string) => void }) {
  if (speakers.length < 2) return null
  return <div className="transcript-speaker-filter" aria-label="Speaker filter">{[ALL_SPEAKERS, ...speakers].map((option) => <Button key={option} className="compact-action transcript-chip" aria-pressed={speaker === option} onClick={() => onSpeaker(option)}>{option}</Button>)}</div>
}

function TranscriptSegmentList({ segments }: { segments: MeetingSegment[] }) {
  if (segments.length === 0) return <div className="transcript-empty-filter">{EMPTY_FILTER_TEXT}</div>
  return <div className="transcript-segments">{segments.map((segment, index) => <TranscriptSegmentRow key={segmentKey(segment, index)} segment={segment} />)}</div>
}

function TranscriptSegmentRow({ segment }: { segment: MeetingSegment }) {
  return <div className="transcript-segment"><span className="transcript-time">{formatSegmentTime(segment.startSec)}</span><div className="transcript-segment-body"><div className="transcript-segment-meta"><span className="transcript-speaker">{segment.speaker}</span></div><p className="transcript-segment-text">{segment.text}</p></div></div>
}

function TranscriptGroupView({ group }: { group: TranscriptGroup }) {
  return <section className="transcript-group">{group.speaker ? <div className="transcript-speaker">{group.speaker}</div> : null}<div className="transcript-lines">{group.lines.map((line, index) => <p key={index}>{line}</p>)}</div></section>
}

function transcriptGroups(value: string): TranscriptGroup[] {
  return value.split('\n').reduce<TranscriptGroup[]>((groups, line) => appendTranscriptLine(groups, line), [])
}

function appendTranscriptLine(groups: TranscriptGroup[], line: string): TranscriptGroup[] {
  const trimmed = line.trim()
  if (!trimmed) return groups
  const match = SPEAKER_LINE_PATTERN.exec(trimmed)
  const speaker = match?.[1] ?? null
  const text = match?.[2]?.trim() || trimmed
  return appendTranscriptGroup(groups, speaker, text)
}

function appendTranscriptGroup(groups: TranscriptGroup[], speaker: string | null, text: string): TranscriptGroup[] {
  const previous = groups[groups.length - 1]
  if (previous?.speaker === speaker) previous.lines.push(text)
  else groups.push({ speaker, lines: [text] })
  return groups
}

function transcriptSpeakers(segments: MeetingSegment[]): string[] {
  return Array.from(new Set(segments.map((segment) => segment.speaker).filter(Boolean)))
}

function visibleTranscriptSegments(segments: MeetingSegment[], speaker: string): MeetingSegment[] {
  if (speaker === ALL_SPEAKERS) return segments
  return segments.filter((segment) => segment.speaker === speaker)
}

function segmentKey(segment: MeetingSegment, index: number): string {
  return segment.id || `${segment.startSec}-${segment.endSec}-${segment.speaker}-${index}`
}

function formatSegmentTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
}
