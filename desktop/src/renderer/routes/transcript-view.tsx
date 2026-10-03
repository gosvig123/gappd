import { type CSSProperties, useMemo, useState } from 'react'
import type { MeetingDetail, MeetingSegment } from '../../shared/contracts'
import { meetingHasWork } from '../components/meeting-progress'
import { MultiSelect } from '../components/ui'
import './transcript-view.css'

const EMPTY_FILTER_TEXT = 'No speakers selected.'
const SPEAKER_LINE_PATTERN = /^\[([^\]]+)\]\s*(.*)$/
type TranscriptGroup = { speaker: string | null; lines: string[] }
type TranscriptSpeaker = { key: string; name: string }
type SegmentTurn = { speakerKey: string; speaker: string; startSec: number; texts: string[]; key: string }

export function TranscriptText({ value, segments, onSeek, currentSec }: { value: string; segments: MeetingSegment[]; onSeek?: (sec: number) => void; currentSec?: number }) {
  if (segments.length > 0) return <TranscriptSegments segments={segments} onSeek={onSeek} currentSec={currentSec} />
  return <div className="transcript-groups">{transcriptGroups(value).map((group, index) => <TranscriptGroupView key={index} group={group} />)}</div>
}

export function meetingTranscript(meeting: MeetingDetail, transcript: string): string {
  return transcript || (meeting.segments ?? []).map(segmentTranscriptLine).filter(Boolean).join('\n')
}

export function meetingHasSegments(meeting: MeetingDetail): boolean { return (meeting.segments?.length ?? 0) > 0 }

export function meetingTranscriptEmptyText(meeting: MeetingDetail): string {
  if (meetingHasWork(meeting)) return 'Transcript is being created locally…'
  return 'No transcript yet.'
}

function TranscriptSegments({ segments, onSeek, currentSec }: { segments: MeetingSegment[]; onSeek?: (sec: number) => void; currentSec?: number }) {
  const [hidden, setHidden] = useState<string[]>([])
  const speakers = useMemo(() => transcriptSpeakers(segments), [segments])
  const visible = visibleTranscriptSegments(segments, speakers.length < 2 ? [] : hidden)
  return <div className="transcript-segment-view"><SpeakerFilter speakers={speakers} hidden={hidden} onChange={setHidden} /><TranscriptSegmentList segments={visible} onSeek={onSeek} currentSec={currentSec} /></div>
}

function SpeakerFilter({ speakers, hidden, onChange }: { speakers: TranscriptSpeaker[]; hidden: string[]; onChange: (speakers: string[]) => void }) {
  if (speakers.length < 2) return null
  const selected = speakers.filter((speaker) => !hidden.includes(speaker.key)).map(speaker => speaker.key)
  const options = speakers.map((speaker) => ({ value: speaker.key, label: <><span className="transcript-chip-dot" style={speakerStyle(speaker.key)} aria-hidden="true" /><SpeakerName speaker={speaker.name} /></> }))
  return <div className="transcript-speaker-filter" data-page-search-ignore><MultiSelect ariaLabel="Filter speakers" allLabel="All speakers" options={options} selected={selected} onChange={(values) => onChange(speakers.filter((speaker) => !values.includes(speaker.key)).map(speaker => speaker.key))} /></div>
}

function TranscriptSegmentList({ segments, onSeek, currentSec }: { segments: MeetingSegment[]; onSeek?: (sec: number) => void; currentSec?: number }) {
  if (segments.length === 0) return <div className="transcript-empty-filter">{EMPTY_FILTER_TEXT}</div>
  const turns = segmentTurns(segments)
  return <div className="transcript-segments">{turns.map((turn) => <TranscriptTurnRow key={turn.key} turn={turn} onSeek={onSeek} active={currentSec !== undefined && turn.startSec <= currentSec && (turns.find(next => next.startSec > turn.startSec)?.startSec ?? Infinity) > currentSec} />)}</div>
}

function TranscriptTurnRow({ turn, onSeek, active }: { turn: SegmentTurn; onSeek?: (sec: number) => void; active: boolean }) {
  return (
    <article className="transcript-turn" aria-current={active ? "true" : undefined} style={speakerStyle(turn.speakerKey)}>
      <SpeakerAvatar speaker={turn.speaker} />
      <div className="transcript-turn-body">
        <div className="transcript-turn-meta">
          <button type="button" className="transcript-speaker transcript-speaker-label" title="Label this speaker" onClick={() => openSpeakerLabels(turn.speakerKey)}><SpeakerName speaker={turn.speaker} /></button>
          {onSeek ? <button type="button" className="transcript-time" onClick={() => onSeek(turn.startSec)} aria-label={`Seek Meeting to ${formatSegmentTime(turn.startSec)}`}>{formatSegmentTime(turn.startSec)}</button> : <span className="transcript-time">{formatSegmentTime(turn.startSec)}</span>}
        </div>
        <div className="transcript-turn-lines">{turn.texts.map((text, index) => <p key={index} className="transcript-segment-text">{text}</p>)}</div>
      </div>
    </article>
  )
}

function TranscriptGroupView({ group }: { group: TranscriptGroup }) {
  if (!group.speaker) {
    return <section className="transcript-turn transcript-turn-plain"><div className="transcript-turn-lines">{group.lines.map((line, index) => <p key={index}>{line}</p>)}</div></section>
  }
  return (
    <article className="transcript-turn" style={speakerStyle(group.speaker)}>
      <SpeakerAvatar speaker={group.speaker} />
      <div className="transcript-turn-body">
        <div className="transcript-turn-meta"><span className="transcript-speaker"><SpeakerName speaker={group.speaker} /></span></div>
        <div className="transcript-turn-lines">{group.lines.map((line, index) => <p key={index} className="transcript-segment-text">{line}</p>)}</div>
      </div>
    </article>
  )
}

function SpeakerName({ speaker }: { speaker: string }) {
  return <span data-page-search-ignore>{speaker}</span>
}

function SpeakerAvatar({ speaker }: { speaker: string }) {
  return <span className="transcript-avatar" aria-hidden="true">{speakerInitials(speaker)}</span>
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

function segmentTranscriptLine(segment: MeetingSegment): string {
  if (!segment.text) return ''
  return `${segment.speaker ? `[${segment.speaker}] ` : ''}${segment.text}`
}

function segmentTurns(segments: MeetingSegment[]): SegmentTurn[] {
  return segments.reduce<SegmentTurn[]>((turns, segment, index) => {
    const previous = turns[turns.length - 1]
    if (previous && previous.speakerKey === (segment.speakerKey || segment.speaker)) previous.texts.push(segment.text)
    else turns.push({ speakerKey: segment.speakerKey || segment.speaker, speaker: segment.speaker, startSec: segment.startSec, texts: [segment.text], key: segmentKey(segment, index) })
    return turns
  }, [])
}

function transcriptSpeakers(segments: MeetingSegment[]): TranscriptSpeaker[] {
  return Array.from(new Map(segments.filter(segment => segment.speaker).map(segment => [segment.speakerKey || segment.speaker, { key: segment.speakerKey || segment.speaker, name: segment.speaker }])).values())
}

function visibleTranscriptSegments(segments: MeetingSegment[], hidden: string[]): MeetingSegment[] {
  return hidden.length ? segments.filter((segment) => !hidden.includes(segment.speakerKey || segment.speaker)) : segments
}

function segmentKey(segment: MeetingSegment, index: number): string {
  return segment.id || `${segment.startSec}-${segment.endSec}-${segment.speaker}-${index}`
}

function speakerStyle(speaker: string): CSSProperties {
  return { '--speaker-hue': speakerHue(speaker) } as CSSProperties
}

function speakerHue(speaker: string): number {
  let hash = 0
  for (let index = 0; index < speaker.length; index += 1) hash = (hash * 31 + speaker.charCodeAt(index)) | 0
  return Math.abs(hash) % 360
}

function speakerInitials(speaker: string): string {
  const words = speaker.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function formatSegmentTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function openSpeakerLabels(speakerKey: string) {
  const panel = document.getElementById("meeting-speaker-labels") as HTMLDetailsElement | null
  if (panel) { panel.open = true; panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); document.getElementById(`speaker-label-${encodeURIComponent(speakerKey)}`)?.querySelector("select")?.focus() }
}
