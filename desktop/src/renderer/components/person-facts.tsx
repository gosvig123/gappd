import { useEffect, useState } from 'react'
import type { PersonFact } from '../../shared/participant-contract'
import type { AppView } from '../lib/app-view'
import { shortDate } from '../lib/person-activity'
import { errorText } from './person-forms'

// Kinds in display order, with their headings. The backend gives only these kinds.
const KINDS: Array<[kind: string, heading: string]> = [
  ['work', 'Work'], ['personal', 'Personal'], ['preference', 'Preferences'], ['interest', 'Interests'], ['goal', 'Goals'],
]

type Props = { personId: string; firstName: string; view: AppView }

/** What a Person said about themselves in Meetings, grouped by kind, each with its source and quote. */
export function PersonFacts({ personId, firstName, view }: Props) {
  const { facts, error, setHidden } = usePersonFacts(personId, view)
  const [showHidden, setShowHidden] = useState(false)
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
      {facts !== null && shown.length === 0 ? <p className="app-block-note app-person-empty">Nothing yet. Gappd notes facts after the notes of a new Meeting with {firstName} are ready.</p> : null}
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
        <button type="button" className="app-link app-fact-hide" onClick={() => onHidden(!fact.hidden)}>{fact.hidden ? 'Show' : 'Hide'}</button>
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

/** Facts appear when the background step reads a Meeting, so the list reloads when any Meeting status changes. */
function usePersonFacts(personId: string, view: AppView) {
  const [state, setState] = useState<{ facts: PersonFact[] | null; error: string | null }>({ facts: null, error: null })
  const revision = view.meetings.map((meeting) => meeting.status.updatedAt).join('|')
  useEffect(() => {
    let active = true
    window.gappd.meetings.personFacts(personId)
      .then((facts) => { if (active) setState({ facts, error: null }) })
      .catch((cause) => { if (active) setState({ facts: null, error: `Could not load facts: ${errorText(cause)}` }) })
    return () => { active = false }
  }, [personId, revision])
  const setHidden = (fact: number, hidden: boolean) => {
    window.gappd.meetings.hidePersonFact({ id: personId, fact, hidden })
      .then((facts) => setState({ facts, error: null }))
      .catch((cause) => setState((current) => ({ ...current, error: `Could not ${hidden ? 'hide' : 'show'} the fact: ${errorText(cause)}` })))
  }
  return { ...state, setHidden }
}
