import { type CSSProperties, useMemo, useState } from 'react'
import type { MeetingSegment } from '../../shared/contracts'
import './transcript-view.css'

const ALL_SPEAKERS = 'All'
const EMPTY_FILTER_TEXT = 'No transcript lines for this speaker yet.'
const SPEAKER_LINE_PATTERN = /^\[([^\]]+)\]\s*(.*)$/
type TranscriptGroup = { speaker: string | null; lines: string[] }
type SegmentTurn = { speaker: string; startSec: number; texts: string[]; key: string }

export function TranscriptText({ value, segments }: { value: string; segments: MeetingSegment[] }) {
  if (segments.length > 0) return <TranscriptSegments segments={segments} />
  return <div className="transcript-groups">{transcriptGroups(value).map((group, index) => <TranscriptGroupView key={index} group={group} />)}</div>
}

function TranscriptSegments({ segments }: { segments: MeetingSegment[] }) {
  const [hidden, setHidden] = useState<string[]>([])
  const speakers = useMemo(() => transcriptSpeakers(segments), [segments])
  const visible = visibleTranscriptSegments(segments, speakers.length < 2 ? [] : hidden)
  return <div className="transcript-segment-view"><SpeakerFilter speakers={speakers} hidden={hidden} onChange={setHidden} /><TranscriptSegmentList segments={visible} /></div>
}

function SpeakerFilter({ speakers, hidden, onChange }: { speakers: string[]; hidden: string[]; onChange: (speakers: string[]) => void }) {
  if (speakers.length < 2) return null
  const visible = speakers.length - hidden.filter((speaker) => speakers.includes(speaker)).length
  return (
    <details className="transcript-speaker-filter">
      <summary className="transcript-chip">{visible === speakers.length ? 'All speakers' : `${visible} of ${speakers.length} speakers`}</summary>
      <div className="transcript-speaker-menu" role="group" aria-label="Filter speakers">
        <label className="transcript-speaker-option"><input type="checkbox" checked={visible === speakers.length} onChange={(event) => onChange(event.target.checked ? [] : speakers)} />{ALL_SPEAKERS}</label>
        {speakers.map((speaker) => <label key={speaker} className="transcript-speaker-option" style={speakerStyle(speaker)}><input type="checkbox" checked={!hidden.includes(speaker)} onChange={() => onChange(hidden.includes(speaker) ? hidden.filter((value) => value !== speaker) : [...hidden, speaker])} /><span className="transcript-chip-dot" aria-hidden="true" /><SpeakerName speaker={speaker} /></label>)}
      </div>
    </details>
  )
}

function TranscriptSegmentList({ segments }: { segments: MeetingSegment[] }) {
  if (segments.length === 0) return <div className="transcript-empty-filter">{EMPTY_FILTER_TEXT}</div>
  const turns = segmentTurns(segments)
  return <div className="transcript-segments">{turns.map((turn) => <TranscriptTurnRow key={turn.key} turn={turn} />)}</div>
}

function TranscriptTurnRow({ turn }: { turn: SegmentTurn }) {
  return (
    <article className="transcript-turn" style={speakerStyle(turn.speaker)}>
      <SpeakerAvatar speaker={turn.speaker} />
      <div className="transcript-turn-body">
        <div className="transcript-turn-meta">
          <span className="transcript-speaker"><SpeakerName speaker={turn.speaker} /></span>
          <span className="transcript-time">{formatSegmentTime(turn.startSec)}</span>
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

function segmentTurns(segments: MeetingSegment[]): SegmentTurn[] {
  return segments.reduce<SegmentTurn[]>((turns, segment, index) => {
    const previous = turns[turns.length - 1]
    if (previous && previous.speaker === segment.speaker) previous.texts.push(segment.text)
    else turns.push({ speaker: segment.speaker, startSec: segment.startSec, texts: [segment.text], key: segmentKey(segment, index) })
    return turns
  }, [])
}

function transcriptSpeakers(segments: MeetingSegment[]): string[] {
  return Array.from(new Set(segments.map((segment) => segment.speaker).filter(Boolean)))
}

function visibleTranscriptSegments(segments: MeetingSegment[], hidden: string[]): MeetingSegment[] {
  return hidden.length ? segments.filter((segment) => !hidden.includes(segment.speaker)) : segments
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
