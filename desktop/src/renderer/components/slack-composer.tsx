import { SLACK_SEND_TEXT_MAX_LENGTH, type SlackSendReview } from '../../shared/slack-contract'
import { useSlackSend, type SlackSendController, type SlackSendNotice } from '../hooks/use-slack-send'
import { Button } from './ui'
import { SlackDestinationPicker } from './slack-destination-picker'
import './slack-composer.css'

/** Composer for one confirmed message. Review shows exactly what the main process holds. */
export function SlackComposer({ accountKey }: { accountKey: string }) {
  const send = useSlackSend(accountKey)
  const overLimit = send.text.length > SLACK_SEND_TEXT_MAX_LENGTH
  const canReview = !send.busy && !overLimit && send.destination.trim().length > 0 && send.text.trim().length > 0
  return (
    <div className="slack-composer">
      <SlackDestinationPicker value={send.destination} onChange={send.setDestination} disabled={Boolean(send.busy)} />
      <label className="field" htmlFor="slack-destination">
        <span>Destination ID or Slack link</span>
        <input id="slack-destination" value={send.destination} disabled={Boolean(send.busy)} placeholder="C0123ABC or a Slack message link" onChange={(event) => send.setDestination(event.target.value)} />
      </label>
      <label className="field" htmlFor="slack-message">
        <span>Message</span>
        <textarea id="slack-message" className="slack-message-input" value={send.text} rows={5} disabled={Boolean(send.busy)} placeholder="Message text" onChange={(event) => send.setText(event.target.value)} />
      </label>
      <div className="slack-composer-meta">
        <span className={overLimit ? 'danger' : undefined}>{send.text.length} of {SLACK_SEND_TEXT_MAX_LENGTH} characters</span>
        <span>Slack shows this as plain text; links, formatting, and mentions stay literal.</span>
      </div>
      {send.review ? <SlackReview review={send.review} send={send} /> : null}
      {send.notice ? <SlackNotice notice={send.notice} /> : null}
      <div className="actions-row">
        <Button variant="primary" disabled={!canReview} onClick={() => void send.reviewMessage()}>{send.busy === 'review' ? 'Reviewing…' : 'Review message'}</Button>
      </div>
    </div>
  )
}

function SlackReview({ review, send }: { review: SlackSendReview; send: SlackSendController }) {
  return (
    <div className="slack-review">
      <div className="slack-review-head"><strong>Review before sending</strong><span>Slack sends this message only after you confirm.</span></div>
      <dl className="slack-review-facts">
        <div><dt>Channel</dt><dd>{review.destination.channelId}</dd></div>
        <div><dt>Thread</dt><dd>{review.destination.threadTs ? `reply to ${review.destination.threadTs}` : 'new message'}</dd></div>
        <div><dt>Workspace</dt><dd>{review.teamId}</dd></div>
        <div><dt>Slack account</dt><dd>{review.userId}</dd></div>
      </dl>
      <pre className="slack-review-text">{review.text}</pre>
      <div className="actions-row">
        <Button variant="primary" disabled={send.busy === 'send'} onClick={() => void send.sendReviewed()}>{send.busy === 'send' ? 'Waiting for confirmation…' : 'Send to Slack'}</Button>
      </div>
    </div>
  )
}

function SlackNotice({ notice }: { notice: SlackSendNotice }) {
  return <div className={notice.tone === 'danger' ? 'status-note danger' : `status-note ${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>{notice.message}{notice.link ? <span className="slack-message-link">{notice.link}</span> : null}</div>
}
