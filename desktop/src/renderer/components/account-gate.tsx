import { useState } from 'react'
import type { useAccountRequirement } from '../hooks/use-account-requirement'
import { Button } from './ui'
import './account-gate.css'

type AccountRequirement = ReturnType<typeof useAccountRequirement>

/**
 * The first screen of a new install. It has no skip: the way past it without an account
 * shows only after a sign-in attempt ends without one, so a failed sign-in never blocks.
 */
export function AccountGate({ account }: { account: AccountRequirement }) {
  const { cloud } = account
  const [attempted, setAttempted] = useState(false)
  const signIn = () => { setAttempted(true); void cloud.signIn() }
  return <main className="account-gate">
    <section className="account-gate-card" aria-labelledby="account-gate-title">
      <div className="app-brand"><span className="app-mark" aria-hidden="true">G</span><span className="app-brand-name">Gappd</span></div>
      <h1 id="account-gate-title">Create your free Gappd account</h1>
      <p>Use your Google account or any email address. Your browser opens; it takes about a minute.</p>
      <p className="account-gate-note">Signing in uploads nothing. Meeting sync stays off until you turn it on in Settings.</p>
      {cloud.connecting
        ? <>
          <p className="account-gate-note" role="status">Finish signing up in your browser, then come back to Gappd.</p>
          <Button onClick={() => void cloud.cancel()}>Cancel</Button>
        </>
        : <Button variant="primary" onClick={signIn}>Sign up or sign in</Button>}
      {cloud.error && !cloud.connecting ? <p className="account-gate-warning" role="alert">{cloud.error}</p> : null}
      {attempted && !cloud.connecting
        ? <div className="account-gate-later">
          <button type="button" className="app-link" onClick={account.continueWithoutAccount}>Continue without an account for now</button>
          <p className="account-gate-note">Gappd asks again the next time you open it.</p>
        </div>
        : null}
    </section>
  </main>
}
