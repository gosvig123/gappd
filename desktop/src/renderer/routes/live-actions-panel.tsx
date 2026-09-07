import './live-actions-panel.css'
import type { MeetingDetail } from '../../shared/contracts'
import type { LiveActionDraft } from '../../shared/generated/live-actions'
import { Button } from '../components/ui'
import { useLiveActions } from '../hooks/use-live-actions'

export function LiveActionsPanel({ meeting, onUpdated }: { meeting: MeetingDetail; onUpdated: (meeting: MeetingDetail) => void }) {
  const { draft, generating, error, generate } = useLiveActions(meeting, onUpdated)
  const hasTranscript = meeting.segments.some((segment) => Boolean(segment.text.trim()))
  return <section className="detail-surface live-actions-panel" aria-label="Draft action items">
    <h2>Draft action items</h2>
    <Button className="compact-action" disabled={!hasTranscript || generating} onClick={() => void generate()}>{generating ? 'Generating…' : 'Generate action items'}</Button>
    {!hasTranscript ? <p>Available after stored Live Transcript text arrives.</p> : null}
    {generating ? <p role="status">Generating from a fixed Live Transcript snapshot. Recording continues. Local AI can slow Live Transcript updates.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {draft ? <DraftItems draft={draft} generating={generating} /> : <p>Generate a read-only draft from available Live Transcript text. Each generation replaces the previous draft. The final summary is separate.</p>}
  </section>
}

function DraftItems({ draft, generating }: { draft: LiveActionDraft; generating: boolean }) {
  return <div>
    <p>{generating ? 'Previous draft. ' : ''}Snapshot taken {new Date(draft.snapshotAt).toLocaleTimeString()}: {draft.segmentCount} stored segments. Latest included segment ends at {formatTime(draft.latestSegmentEnd)}.</p>
    <p>This is partial coverage, not complete audio through that time. Microphone and system audio can arrive at different times. New transcript text is not included until you generate again.</p>
    {draft.actions.length ? <ul>{draft.actions.map((action, index) => <li key={`${draft.snapshotId}:${index}`}><strong>{action.task}</strong>{action.owner ? <span> — {action.owner}</span> : null}{action.deadline ? <span> · {action.deadline}</span> : null}</li>)}</ul> : <p>No supported action items were found in this snapshot.</p>}
  </div>
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
