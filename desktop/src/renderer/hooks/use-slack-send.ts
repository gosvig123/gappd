import { useCallback, useEffect, useRef, useState } from 'react'
import type { SlackSendResult, SlackSendReview } from '../../shared/slack-contract'

export type SlackSendNotice = { tone: 'neutral' | 'danger' | 'success'; message: string; link: string | null }

export type SlackSendController = {
  destination: string
  text: string
  review: SlackSendReview | null
  busy: 'review' | 'send' | null
  notice: SlackSendNotice | null
  setDestination(value: string): void
  setText(value: string): void
  reviewMessage(): Promise<void>
  sendReviewed(): Promise<void>
}

/** Composer state for the Slack panel. The main process owns the reviewed message. */
export function useSlackSend(accountKey: string): SlackSendController {
  const [destination, setDestinationState] = useState('')
  const [text, setTextState] = useState('')
  const [review, setReview] = useState<SlackSendReview | null>(null)
  const [busy, setBusy] = useState<'review' | 'send' | null>(null)
  const [notice, setNotice] = useState<SlackSendNotice | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    setDestinationState(''); setTextState(''); setReview(null); setNotice(null)
  }, [accountKey])

  const setDestination = useCallback((value: string) => { setDestinationState(value); setReview(null); setNotice(null) }, [])
  const setText = useCallback((value: string) => { setTextState(value); setReview(null); setNotice(null) }, [])

  const reviewMessage = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('review'); setNotice(null)
    try {
      setReview(await window.gappd.slack.review({ destination, text }))
    } catch (cause) {
      setReview(null); setNotice(failureNotice(cause))
    } finally {
      inFlight.current = false; setBusy(null)
    }
  }, [destination, text])

  const sendReviewed = useCallback(async () => {
    if (!review || inFlight.current) return
    const reviewId = review.id
    inFlight.current = true
    setBusy('send'); setNotice(null)
    try {
      setReview(null)
      applyResult(await window.gappd.slack.send(reviewId), setTextState, setNotice)
    } catch (cause) {
      setReview(null); setNotice(failureNotice(cause))
    } finally {
      inFlight.current = false; setBusy(null)
    }
  }, [review])

  return { destination, text, review, busy, notice, setDestination, setText, reviewMessage, sendReviewed }
}

function applyResult(result: SlackSendResult, setText: (value: string) => void, setNotice: (value: SlackSendNotice) => void): void {
  if (result.status === 'sent') {
    setText('')
    setNotice({ tone: 'success', message: 'Sent to Slack.', link: result.messageLink })
    return
  }
  if (result.status === 'cancelled') {
    setNotice({ tone: 'neutral', message: 'Message not sent. Review it again to send.', link: null })
    return
  }
  setNotice({ tone: 'danger', message: result.message, link: null })
}

function failureNotice(cause: unknown): SlackSendNotice {
  return { tone: 'danger', message: cause instanceof Error ? cause.message : String(cause), link: null }
}
