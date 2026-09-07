import { useRef, useState } from 'react'
import type { MeetingDetail } from '../../shared/contracts'
import { generateLiveActions } from './live-actions-generation'
import { useGuardedEffect } from './use-guarded-effect'

export function useLiveActions(meeting: MeetingDetail, onUpdated: (meeting: MeetingDetail) => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const current = useRef(meeting)
  current.current = meeting
  const flight = useRef(false)
  const guard = useRef<(work: () => void) => void>(() => {})
  useGuardedEffect((next) => { guard.current = next }, [meeting.id])
  async function generate() {
    if (flight.current || meeting.liveActionsGenerating) return
    flight.current = true; setPending(true); setError(undefined)
    const apply = guard.current
    try {
      const { draft } = await generateLiveActions(meeting.id)
      apply(() => onUpdated({ ...current.current, liveActionDraft: draft, liveActionsGenerating: false }))
    } catch (cause) { apply(() => setError(cause instanceof Error ? cause.message : String(cause))) }
    finally { flight.current = false; apply(() => setPending(false)) }
  }
  return { draft: meeting.liveActionDraft, generating: pending || Boolean(meeting.liveActionsGenerating), error, generate }
}
