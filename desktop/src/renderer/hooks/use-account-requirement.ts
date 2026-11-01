import { useEffect, useState } from 'react'
import { useCloudAccount } from './use-cloud-account'
import { useGuardedEffect } from './use-guarded-effect'

export const ACCOUNT_ASKS_KEY = 'gappd.setup.accountAsks'
export const ACCOUNT_SIGNED_IN_KEY = 'gappd.setup.accountSignedIn'
export const CALENDAR_SKIPPED_KEY = 'gappd.setup.calendarSkipped'
export const NOTES_SKIPPED_KEY = 'gappd.setup.notesSkipped'
export const FINISHED_SHOWN_KEY = 'gappd.setup.finishedShown'
// sessionStorage ends with the window, so Gappd asks again the next time it opens.
const CONTINUED_KEY = 'gappd.setup.accountContinued'
// v0.1.32 saved the setup account answer (sign-in or Not now) here.
const LEGACY_ACCOUNT_ANSWERED_KEY = 'gappd.setup.accountAnswered'

/**
 * New installs need a Gappd account before they use the app. A sign-in that does not finish
 * (offline, cancelled, Clerk down) never blocks recording: after a failed or cancelled attempt
 * the person can continue without an account until Gappd opens again. Once signed in, a later
 * sign-out in Settings does not ask again.
 */
export function useAccountRequirement() {
  const cloud = useCloudAccount()
  const { asks, failed } = useAccountAsks()
  const [signedIn, setSignedIn] = useState(() => window.localStorage.getItem(ACCOUNT_SIGNED_IN_KEY) === 'true')
  const [continued, setContinued] = useState(() => window.sessionStorage.getItem(CONTINUED_KEY) === 'true')
  const email = cloud.account?.email
  useEffect(() => {
    if (!email || signedIn) return
    window.localStorage.setItem(ACCOUNT_SIGNED_IN_KEY, 'true')
    setSignedIn(true)
  }, [email, signedIn])
  const continueWithoutAccount = () => { window.sessionStorage.setItem(CONTINUED_KEY, 'true'); setContinued(true) }
  // Until a new install is told apart, show nothing rather than an app it may not use yet.
  // After a failed read the app opens, and a later answer gates only the next launch.
  const deciding = asks === null && !failed
  return { cloud, asks, signedIn, deciding, required: asks === true && !failed && !signedIn && !email && !continued, continueWithoutAccount }
}

/**
 * Only new installs need an account: no setup answer saved and no Meetings yet. It is
 * decided once; a failed Meeting list read retries instead of deciding.
 */
function useAccountAsks(): { asks: boolean | null; failed: boolean } {
  const [asks, setAsks] = useState<boolean | null>(() => {
    if (window.localStorage.getItem(LEGACY_ACCOUNT_ANSWERED_KEY) === 'true') return false
    const saved = window.localStorage.getItem(ACCOUNT_ASKS_KEY)
    return saved === null ? null : saved === 'true'
  })
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useGuardedEffect((guard) => {
    if (asks !== null) return
    const save = (value: boolean) => { window.localStorage.setItem(ACCOUNT_ASKS_KEY, String(value)); setAsks(value) }
    if ([FINISHED_SHOWN_KEY, NOTES_SKIPPED_KEY, CALENDAR_SKIPPED_KEY].some((key) => window.localStorage.getItem(key) === 'true')) return save(false)
    let retry: ReturnType<typeof setTimeout> | undefined
    window.gappd.meetings.list().then((meetings) => guard(() => save(meetings.length === 0)))
      .catch(() => guard(() => { setFailed(true); retry = setTimeout(() => setAttempt((value) => value + 1), 5000) }))
    return () => clearTimeout(retry)
  }, [asks, attempt])
  return { asks, failed }
}
