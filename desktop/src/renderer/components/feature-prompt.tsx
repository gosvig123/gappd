import { useState, type ReactNode } from 'react'
import { NOTES_SKIPPED_KEY, type useAccountRequirement } from '../hooks/use-account-requirement'
import { useAIApps } from '../hooks/use-ai-apps'
import { useUsageSharing } from '../hooks/use-usage-sharing'
import type { AppView } from '../lib/app-view'
import { nextFeaturePrompt, wantsAIAppsStatus, type FeaturePrompt as Prompt } from '../lib/feature-prompts'
import { notesAvailability, notesPreparing, setupSteps, setupVisible } from '../lib/setup-steps'
import { AccountPromptCard, useAccountPromptAsk } from './account-prompt'
import { NotesChoicePanel, useNotesChoice } from './notes-choice'
import { Button } from './ui'
import './setup-checklist.css'

const AI_APPS_ANSWERED_KEY = 'gappd.prompts.aiAppsAnswered'

/**
 * Asks about one optional feature when it first helps (see feature-prompts.ts).
 * A prompt stays until the person closes it, so a download or a connection can
 * show its result in the same card.
 */
export function FeaturePrompt({ view, account, notesReady }: { view: AppView; account: ReturnType<typeof useAccountRequirement>; notesReady: boolean }) {
  const [notesAnswered, answerNotes] = useAnswer(NOTES_SKIPPED_KEY)
  const [aiAppsAnswered, answerAIApps] = useAnswer(AI_APPS_ANSWERED_KEY)
  const accountAsk = useAccountPromptAsk(account, notesReady)
  const usage = useUsageSharing()
  const { cloud, asks, signedIn } = account
  // Until Gappd knows whether a new install signs up, setup may still come first.
  const setupOpen = asks === null || setupVisible(setupSteps(view.permissionStatus, view.runtime, { account: cloud.account, asks, signedIn }))
  const answered = { notes: notesAnswered, aiApps: aiAppsAnswered }
  const aiApps = useAIApps(wantsAIAppsStatus({ setupOpen, meetings: view.meetings, answered }))
  const next = nextFeaturePrompt({
    setupOpen, meetings: view.meetings, notes: notesAvailability(view.runtime), aiApps: aiApps.apps,
    accountAsk: accountAsk.asks, usage: usage.status?.sharing ?? null, answered,
  })
  const [shown, setShown] = useState<Prompt | null>(null)
  if (!shown && next) setShown(next)
  const close = () => setShown(null)
  if (shown === 'notes') return <NotesPrompt view={view} onClose={() => { answerNotes(); close() }} />
  if (shown === 'aiApps') return <AIAppsPrompt aiApps={aiApps} onClose={() => { answerAIApps(); close() }} />
  if (shown === 'account') return <AccountPromptCard view={view} cloud={cloud} onAnswer={accountAsk.answer} onClose={close} />
  if (shown === 'usage') return <UsagePrompt usage={usage} onClose={close} />
  return null
}

function PromptCard({ id, title, children, actions }: { id: string; title: string; children: ReactNode; actions: ReactNode }) {
  return <section className="setup-checklist feature-prompt ui-scroll" aria-labelledby={id}>
    <div className="setup-step-body">
      <h2 id={id}>{title}</h2>
      <div className="setup-step-detail">{children}</div>
    </div>
    <div className="setup-step-actions">{actions}</div>
  </section>
}

/** After the first transcript: where to make notes. Gappd then writes notes for earlier Meetings too. */
function NotesPrompt({ view, onClose }: { view: AppView; onClose: () => void }) {
  const on = notesAvailability(view.runtime) === 'ready'
  const preparing = notesPreparing(view.runtime)
  const choice = useNotesChoice(!on && !preparing)
  if (on || choice.saved) return <PromptCard id="notes-prompt-title" title="Notes are on" actions={<Button onClick={onClose}>Done</Button>}>
    <p>Gappd writes notes for your Meetings, also the ones you already recorded. Change where notes are made in Settings › Meeting processing.</p>
  </PromptCard>
  return <PromptCard id="notes-prompt-title" title="Your transcript is ready. Get notes too?" actions={<Button onClick={onClose}>{preparing ? 'Hide' : 'Not now'}</Button>}>
    <p>Gappd can turn each transcript into notes: a summary, decisions, and action items. It writes them for the Meetings you already recorded too.</p>
    <NotesChoicePanel view={view} choice={choice} />
    {preparing ? null : <p className="setup-step-note">Not now keeps transcripts only. You can turn on notes later in Settings.</p>}
  </PromptCard>
}

/** After the first notes: let an installed AI app read Meetings through the local Gappd MCP server. */
function AIAppsPrompt({ aiApps, onClose }: { aiApps: ReturnType<typeof useAIApps>; onClose: () => void }) {
  const installed = (aiApps.apps ?? []).filter((app) => app.state !== 'missing')
  const connected = installed.some((app) => app.state === 'on')
  return <PromptCard id="ai-apps-prompt-title" title="Ask your AI app about your Meetings" actions={<Button onClick={onClose}>{connected ? 'Done' : 'Not now'}</Button>}>
    <p>Connect an AI app on this Mac, then ask it things like "What did we decide in my last meeting?" It reads your Meetings through Gappd on this Mac, only when you ask.</p>
    <div className="feature-prompt-apps">
      {installed.map((app) => <div className="feature-prompt-app" key={app.id}>
        <strong>{app.name}</strong>
        {app.state === 'on'
          ? <span>Connected</span>
          : <Button variant="primary" aria-label={`Connect ${app.name}`} disabled={aiApps.busy !== null} onClick={() => void aiApps.change(app)}>{aiApps.busy === app.id ? 'Connecting…' : 'Connect'}</Button>}
      </div>)}
    </div>
    {aiApps.error ? <p className="setup-step-warning">{aiApps.error}</p> : null}
    {aiApps.restart && !aiApps.error ? <p className="setup-step-note">If {aiApps.restart} is open, quit and reopen it to load the change.</p> : null}
    <p className="setup-step-note">The AI app sends what it reads to its own AI service. Change this later in Settings › Connections.</p>
  </PromptCard>
}

/** After a few Meetings: anonymous usage counts. The answer is saved by the usage report service. */
function UsagePrompt({ usage, onClose }: { usage: ReturnType<typeof useUsageSharing>; onClose: () => void }) {
  const answer = async (share: boolean) => { if (await usage.setSharing(share)) onClose() }
  return <PromptCard id="usage-prompt-title" title="Share anonymous usage counts?" actions={<>
    <Button onClick={() => void answer(true)}>Share</Button>
    <Button onClick={() => void answer(false)}>Don't share</Button>
  </>}>
    <p>Once a day, Gappd can send counts that help us improve it: how many Meetings you recorded in a range such as 2–5, total minutes, and which features are on.</p>
    <p className="setup-step-note">No account or ID, and no names, titles, transcripts, or notes. Change this in Settings › General.</p>
    {usage.error ? <p className="setup-step-warning">{usage.error}</p> : null}
  </PromptCard>
}

function useAnswer(key: string): [boolean, () => void] {
  const [answered, setAnswered] = useState(() => window.localStorage.getItem(key) === 'true')
  return [answered, () => { window.localStorage.setItem(key, 'true'); setAnswered(true) }]
}
