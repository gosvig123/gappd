import { useEffect, useState } from 'react'
import type { GmailThread } from '../../shared/calendar-contract'
import { EmptyState } from './ui'

type EmailState = { status: 'loading' } | { status: 'ready'; threads: GmailThread[] } | { status: 'error'; error: string }

/** Recent Gmail threads with one Person, read from Google each time it opens. */
export function PersonEmail({ name, email }: { name: string; email: string }) {
  const [state, setState] = useState<EmailState>({ status: 'loading' })
  const [openError, setOpenError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    window.gappd.googleCalendar.gmailThreads(email).then(
      (threads) => { if (active) setState({ status: 'ready', threads }) },
      (cause) => { if (active) setState({ status: 'error', error: errorText(cause) }) },
    )
    return () => { active = false }
  }, [email])
  const open = (thread: GmailThread) => {
    setOpenError(null)
    window.gappd.googleCalendar.openGmailThread(thread.accountEmail, thread.threadId).catch((cause) => setOpenError(errorText(cause)))
  }
  return (
    <section className="app-person-email" aria-label={`Recent email with ${name}`}>
      <p className="app-person-form-note">Recent Gmail threads with {email}. Read from Google now; not saved.</p>
      {state.status === 'loading' ? <p className="app-person-form-note" role="status">Loading email…</p> : null}
      {state.status === 'error' ? <p role="alert" className="app-error">{state.error}</p> : null}
      {state.status === 'ready' && !state.threads.length ? <EmptyState>No Gmail threads with {email}.</EmptyState> : null}
      {state.status === 'ready' && state.threads.length ? (
        <ul className="app-person-threads">
          {state.threads.map((thread) => (
            <li key={`${thread.accountEmail}:${thread.threadId}`}>
              <button type="button" className="app-person-thread" title="Open in Gmail" onClick={() => open(thread)}>
                <strong>{thread.subject}</strong>
                <span>{threadMeta(thread)}</span>
                {thread.snippet ? <span className="app-person-thread-snippet">{thread.snippet}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {openError ? <p role="alert" className="app-error">{openError}</p> : null}
    </section>
  )
}

function threadMeta(thread: GmailThread): string {
  const from = thread.from.replace(/\s*<[^>]*>\s*$/, '').replace(/^"(.*)"$/, '$1') || thread.from
  const date = thread.date ? new Date(thread.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const count = thread.messageCount > 1 ? `${thread.messageCount} messages` : ''
  return [from, date, count].filter(Boolean).join(' · ')
}

function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(?:Error:\s*)+/, '').trim()
}
