import { useEffect, useRef, useState } from 'react'
import type { PersonFact, PersonFacts as PersonFactsState } from '../../shared/participant-contract'
import type { AppView } from '../lib/app-view'
import { shortDate } from '../lib/person-activity'
import { errorText } from './person-forms'
import { Button } from './ui'

// Kinds in display order, with their headings. The backend gives only these kinds.
const KINDS: Array<[kind: string, heading: string]> = [
  ['work', 'Work'], ['personal', 'Personal'], ['preference', 'Preferences'], ['interest', 'Interests'], ['goal', 'Goals'],
]

type Props = { personId: string; firstName: string; view: AppView }

/** What a Person said about themselves in Meetings, grouped by kind, each with its source and quote. */
export function PersonFacts({ personId, firstName, view }: Props) {
  const { state, error, setHidden, readEarlier } = usePersonFacts(personId, view)
  const facts = state?.facts ?? null
  const [showHidden, setShowHidden] = useState(false)
  const summary = usePersonSummary(personId, facts)
  const hiddenCount = facts?.filter((fact) => fact.hidden).length ?? 0
  const shown = facts?.filter((fact) => showHidden || !fact.hidden) ?? []
  return (
    <section className="app-block" aria-label="About">
      <div className="app-block-head">
        <h2>About</h2>
        <span className="app-block-note">From what {firstName} said in Meetings</span>
        {hiddenCount ? (
          <button type="button" className="app-link app-fact-hidden-toggle" aria-pressed={showHidden} onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Leave out hidden' : `Show ${hiddenCount} hidden`}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="app-error">{error}</p> : null}
      {facts === null && !error ? <p className="app-block-note app-person-empty">Loading…</p> : null}
      {summary.text ? <p className="app-fact-summary">{summary.text}</p> : null}
      {summary.note ? <p className="app-block-note app-person-empty" role={summary.failed ? 'alert' : undefined}>{summary.note}</p> : null}
      {state?.pendingMeetings ? <p className="app-block-note app-person-empty" role="status">{meetingCount(state.pendingMeetings)} queued. Gappd reads them for facts in the background with your notes provider.</p> : null}
      {facts !== null && shown.length === 0 && !state?.pendingMeetings ? <p className="app-block-note app-person-empty">Nothing yet. Gappd notes facts after the notes of a new Meeting with {firstName} are ready.</p> : null}
      {state?.earlierMeetings ? (
        <div className="app-fact-earlier">
          <span className="app-block-note">{meetingCount(state.earlierMeetings)} with {firstName} {state.earlierMeetings === 1 ? 'is' : 'are'} from before Gappd noted facts.</span>
          <Button className="compact-action" onClick={readEarlier}>Build profile from {meetingCount(state.earlierMeetings, 'earlier ')}</Button>
        </div>
      ) : null}
      {KINDS.map(([kind, heading]) => {
        const group = shown.filter((fact) => fact.kind === kind)
        if (!group.length) return null
        return (
          <div key={kind} className="app-fact-group">
            <h3 className="app-fact-kind">{heading}</h3>
            <ul className="app-person-list">
              {group.map((fact) => <FactRow key={fact.id} fact={fact} view={view} onHidden={(hidden) => setHidden(fact.id, hidden)} />)}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function FactRow({ fact, view, onHidden }: { fact: PersonFact; view: AppView; onHidden: (hidden: boolean) => void }) {
  const [quoteOpen, setQuoteOpen] = useState(false)
  return (
    <li className={`app-person-action app-fact${fact.hidden ? ' is-hidden' : ''}`}>
      <span className="app-fact-line">
        <span className="app-fact-text">{fact.text}</span>
        <button type="button" className="app-link app-fact-hide" aria-label={`${fact.hidden ? 'Show' : 'Hide'}: ${fact.text}`} onClick={() => onHidden(!fact.hidden)}>{fact.hidden ? 'Show' : 'Hide'}</button>
      </span>
      <span className="app-block-note">
        <button type="button" className="app-link" onClick={() => view.actions.openMeeting(fact.meetingId)}>{fact.meetingTitle || 'Untitled meeting'}</button>
        {` · ${shortDate(fact.startedAt)} · `}
        <button type="button" className="app-link" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(!quoteOpen)}>{quoteOpen ? 'Hide quote' : 'Quote'}</button>
      </span>
      {quoteOpen ? fact.quotes.map((quote, index) => <blockquote key={index} className="app-fact-quote">“{quote}”</blockquote>) : null}
    </li>
  )
}

/** Reloads when the background step saves facts and when a Meeting status changes (a relabel or new notes). */
function usePersonFacts(personId: string, view: AppView) {
  const [result, setResult] = useState<{ state: PersonFactsState | null; error: string | null }>({ state: null, error: null })
  const [factsRevision, setFactsRevision] = useState(0)
  // Only the newest request may change the list, so a slow reload cannot undo a later Hide or Show.
  const latest = useRef(0)
  const revision = view.meetings.map((meeting) => meeting.status.updatedAt).join('|')
  useEffect(() => window.gappd.meetings.onFactsChanged(() => setFactsRevision((value) => value + 1)), [])
  useEffect(() => {
    const request = ++latest.current
    window.gappd.meetings.personFacts(personId)
      .then((state) => { if (latest.current === request) setResult({ state, error: null }) })
      .catch((cause) => { if (latest.current === request) setResult({ state: null, error: `Could not load facts: ${errorText(cause)}` }) })
    return () => { latest.current++ }
  }, [personId, revision, factsRevision])
  const update = (work: Promise<PersonFactsState>, failure: string) => {
    const request = ++latest.current
    // A reload that started during the change can hold older facts, so read again after it.
    work.then((state) => { if (latest.current === request) setResult({ state, error: null }); else setFactsRevision((value) => value + 1) })
      .catch((cause) => { if (latest.current === request) setResult((current) => ({ ...current, error: `${failure}: ${errorText(cause)}` })) })
  }
  const setHidden = (fact: number, hidden: boolean) => update(window.gappd.meetings.hidePersonFact({ id: personId, fact, hidden }), `Could not ${hidden ? 'hide' : 'show'} the fact`)
  const readEarlier = () => update(window.gappd.meetings.queuePersonFacts(personId), 'Could not read earlier Meetings')
  return { ...result, setHidden, readEarlier }
}

/**
 * Shows the saved summary at once. When the shown facts changed after it was written, it asks the
 * notes provider for a new one, once per set of facts.
 */
function usePersonSummary(personId: string, facts: PersonFact[] | null) {
  const [state, setState] = useState<{ text: string; note: string; failed: boolean }>({ text: '', note: '', failed: false })
  const shownKey = facts?.filter((fact) => !fact.hidden).map((fact) => fact.id).join(',') ?? null
  useEffect(() => {
    if (shownKey === null) return
    let active = true
    const show = (text: string, note = '', failed = false) => { if (active) setState({ text, note, failed }) }
    window.gappd.meetings.personSummary(personId, false)
      .then(async (saved) => {
        if (saved.current) return show(saved.summary)
        show(saved.summary, 'Updating the summary…')
        const written = await window.gappd.meetings.personSummary(personId, true)
        show(written.summary)
      })
      // A failed write keeps the older summary on screen.
      .catch((cause) => { if (active) setState((current) => ({ ...current, note: `Could not update the summary: ${errorText(cause)}`, failed: true })) })
    return () => { active = false }
  }, [personId, shownKey])
  return state
}

function meetingCount(count: number, prefix = ''): string {
  return `${count} ${prefix}${count === 1 ? 'Meeting' : 'Meetings'}`
}
