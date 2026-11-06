import { useCallback, useEffect, useRef, useState } from 'react'
import type { useAccountRequirement } from '../hooks/use-account-requirement'
import type { useCloudAccount } from '../hooks/use-cloud-account'
import type { AppView } from '../lib/app-view'
import { Button } from './ui'

const PROMPT_ANSWERED_KEY = 'gappd.accountPrompt.answered'

/**
 * Whether to ask a signed-out user for an account: notes became ready in this window,
 * because that is when they see what an AI client could read. Only installs from before
 * the required account get it (new installs sign up first), and it never comes back after
 * Not now or a sign-in.
 */
export function useAccountPromptAsk(account: ReturnType<typeof useAccountRequirement>, notesReady: boolean) {
  const { cloud } = account
  const [seen, setSeen] = useState(false)
  const [answered, setAnswered] = useState(() => window.localStorage.getItem(PROMPT_ANSWERED_KEY) === 'true')
  if (notesReady && !seen) setSeen(true)
  const answer = useCallback(() => { window.localStorage.setItem(PROMPT_ANSWERED_KEY, 'true'); setAnswered(true) }, [])
  const email = cloud.account?.email
  // A sign-in anywhere, Settings too, answers the prompt, so a later sign-out does not bring it back.
  useEffect(() => { if (email && !answered) answer() }, [email, answered, answer])
  return { asks: seen && !answered && Boolean(cloud.account) && !email && account.asks === false, answer }
}

/** The account question, then a pointer to Meeting sync after a sign-in here. */
export function AccountPromptCard({ view, cloud, onAnswer, onClose }: { view: AppView; cloud: ReturnType<typeof useCloudAccount>; onAnswer: () => void; onClose: () => void }) {
  const [signedIn, setSignedIn] = useState(false)
  const signingIn = useRef(false)
  const email = cloud.account?.email
  // A sign-in elsewhere (Settings) answers the question, so the card leaves.
  useEffect(() => { if (email && !signingIn.current) onClose() }, [email, onClose])
  const signIn = async () => {
    signingIn.current = true
    if (await cloud.signIn()) { onAnswer(); setSignedIn(true) } else signingIn.current = false
  }
  if (signedIn && cloud.account?.email) return <section className="setup-checklist feature-prompt" aria-labelledby="account-prompt-title">
    <div className="setup-step-body">
      <h2 id="account-prompt-title">Signed in as {cloud.account.email}</h2>
      <p>Turn on Meeting sync in Settings so AI clients you authorize can read your Meetings.</p>
    </div>
    <div className="setup-step-actions">
      <Button variant="primary" onClick={() => { onClose(); view.actions.openSettings('Connections') }}>Open Settings</Button>
      <Button onClick={onClose}>Done</Button>
    </div>
  </section>
  return <section className="setup-checklist feature-prompt" aria-labelledby="account-prompt-title">
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
      <Button disabled={cloud.connecting} onClick={() => { onAnswer(); onClose() }}>Not now</Button>
    </div>
  </section>
}
