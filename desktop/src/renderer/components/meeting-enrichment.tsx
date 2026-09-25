import { useEffect, useState } from 'react'
import type { MeetingEnrichment, MeetingEnrichmentNote } from '../../shared/meeting-enrichment'
import { Button, StatusPill } from './ui'

const EXPLANATION = 'Reads Gmail and existing Slack DMs with this Meeting’s Calendar invitees, from 30 days before to 7 days after the Meeting. The configured AI provider adds context only to action items that are already in these notes; a remote provider receives the message text. No messages are sent, and the notes do not change.'

/** Optional, on-demand context for the summary's action items. The transcript stays the source of truth. */
export function MeetingEnrichmentSection({ meetingId }: { meetingId: string }) {
  const [enrichment, setEnrichment] = useState<MeetingEnrichment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setEnrichment(null)
    setError('')
    window.gappd.meetings.enrichment(meetingId).then(value => { if (current) setEnrichment(value) }, reason => { if (current) setError(errorText(reason)) })
    return () => { current = false }
  }, [meetingId])
  const enrich = async () => {
    setBusy(true)
    setError('')
    try { setEnrichment(await window.gappd.meetings.enrich(meetingId)) }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  return (
    <section className="meeting-enrichment" aria-label="Gmail and Slack context">
      <h2>Gmail and Slack context</h2>
      <p>{EXPLANATION}</p>
      <Button className="compact-action" disabled={busy} onClick={() => void enrich()}>{busy ? 'Reading messages…' : enrichment ? 'Add context again' : 'Add Gmail and Slack context'}</Button>
      {busy ? <p role="status">Reading Gmail and Slack, then asking the configured AI provider. Slack rate limits can add up to 10 minutes.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {enrichment ? <EnrichmentResult enrichment={enrichment} /> : null}
    </section>
  )
}

function EnrichmentResult({ enrichment }: { enrichment: MeetingEnrichment }) {
  const groups = groupByActionItem(enrichment.notes)
  return (
    <>
      <p role="status">From {enrichment.messageCount} messages with invitees of “{enrichment.eventTitle}” · {new Date(enrichment.generatedAt).toLocaleString()}{enrichment.generation?.model ? ` · ${enrichment.generation.model}` : ''}</p>
      {enrichment.stale ? <p role="status">The notes changed after this context was added. Add context again to match the current action items.</p> : null}
      {enrichment.warning ? <p role="status">{enrichment.warning}</p> : null}
      {enrichment.messageCount && !groups.length ? <p role="status">No message clearly relates to an action item.</p> : null}
      {groups.map(([actionItem, notes]) => (
        <div key={actionItem} className="meeting-enrichment-item">
          <h3>{actionItem}</h3>
          {notes.map((note, index) => (
            <div key={`${note.sourceId}:${index}`}>
              <p>{note.status === 'possibly_done' ? <StatusPill tone="processing">Possibly done · confirm</StatusPill> : null} {note.note}</p>
              <blockquote>{note.quote}</blockquote>
              <p className="meeting-enrichment-source">Source: {enrichment.sources.find(source => source.id === note.sourceId)?.title ?? note.sourceId}</p>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

function groupByActionItem(notes: MeetingEnrichmentNote[]): [string, MeetingEnrichmentNote[]][] {
  const groups = new Map<string, MeetingEnrichmentNote[]>()
  for (const note of notes) groups.set(note.actionItem, [...(groups.get(note.actionItem) ?? []), note])
  return [...groups]
}

function errorText(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason)
  const message = raw.replace(/^Error invoking (?:remote method )?['"]?meetings:(?:enrich|enrichment)['"]?:\s*/, '')
    .replace(/^(?:Error:\s*)+/, '').split(/\n(?:Usage:|Flags:|Global Flags:|\s+at\s)/)[0]!.trim()
  if (/context deadline exceeded|operation was aborted|timed out/i.test(message)) return 'Adding context timed out. Try again; no context was saved.'
  return message || 'Adding context failed. Check your AI model in Settings, then retry.'
}
