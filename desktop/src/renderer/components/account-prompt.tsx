import { useCallback, useEffect, useState } from 'react'
import type { useAccountRequirement } from '../hooks/use-account-requirement'
import type { AppView } from '../lib/app-view'
import { Button } from './ui'
import './setup-checklist.css'

const PROMPT_ANSWERED_KEY = 'gappd.accountPrompt.answered'

/**
 * Asks a signed-out user for an account when notes become ready, because that is when they
 * see what an AI client could read. Only installs from before the required account get it
 * (new installs ask in setup), and it never comes back after Not now or a sign-in.
 */
export function AccountPrompt({ view, account, notesReady }: { view: AppView; account: ReturnType<typeof useAccountRequirement>; notesReady: boolean }) {
  const { cloud } = account
  const [seen, setSeen] = useState(false)
  const [answered, setAnswered] = useState(() => window.localStorage.getItem(PROMPT_ANSWERED_KEY) === 'true')
  const [signedIn, setSignedIn] = useState(false)
  if (notesReady && !seen) setSeen(true)
  const answer = useCallback(() => { window.localStorage.setItem(PROMPT_ANSWERED_KEY, 'true'); setAnswered(true) }, [])
  const email = cloud.account?.email
  // A sign-in anywhere, Settings too, answers the prompt, so a later sign-out does not bring it back.
  useEffect(() => { if (email && !answered) answer() }, [email, answered, answer])
  const signIn = async () => { if (await cloud.signIn()) { answer(); setSignedIn(true) } }
  if (signedIn && email) return <section className="setup-checklist setup-finished" aria-labelledby="account-prompt-title">
    <div className="setup-step-body">
      <h2 id="account-prompt-title">Signed in as {cloud.account?.email}</h2>
      <p>Turn on Meeting sync in Settings so AI clients you authorize can read your Meetings.</p>
    </div>
    <div className="setup-step-actions">
      <Button variant="primary" onClick={() => { setSignedIn(false); view.actions.openSettings('Connections') }}>Open Settings</Button>
      <Button onClick={() => setSignedIn(false)}>Done</Button>
    </div>
  </section>
  if (!seen || answered || !cloud.account || email || account.asks !== false) return null
  return <section className="setup-checklist setup-finished" aria-labelledby="account-prompt-title">
    <div className="setup-step-body">
      <h2 id="account-prompt-title">Your notes are ready. Use them in your AI assistant.</h2>
      <p>Create a free Gappd account so the AI assistants you connect can read the Meetings you choose to sync. Use your Google account or any email address.</p>
      <p className="setup-step-note">Signing in uploads nothing. Meeting sync stays off until you turn it on in Settings.</p>
      {cloud.error ? <p className="setup-step-warning">{cloud.error}</p> : null}
    </div>
    <div className="setup-step-actions">
      {cloud.connecting
        ? <Button onClick={() => void cloud.cancel()}>Cancel sign-in</Button>
        : <Button variant="primary" onClick={() => void signIn()}>Sign up or sign in</Button>}
      <Button disabled={cloud.connecting} onClick={answer}>Not now</Button>
    </div>
  </section>
}
