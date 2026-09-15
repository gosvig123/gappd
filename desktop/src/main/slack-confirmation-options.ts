import { createHash } from 'node:crypto'
import type { SlackSendConfirmation } from './slack-send'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { slackDestinationLabel } from './slack-destination.ts'

export const CONFIRM_SEND_URL = 'https://confirmation.invalid/send'
export const CONFIRM_CANCEL_URL = 'https://confirmation.invalid/cancel'
const SCRIPT = `const review = JSON.parse(decodeURIComponent(location.hash.slice(1)));
document.getElementById('destination').textContent = review.destination;
document.getElementById('account').textContent = review.account;
document.getElementById('text').textContent = review.text;
document.getElementById('cancel').focus();
document.addEventListener('keydown', event => { if (event.key === 'Escape') location.href = '${CONFIRM_CANCEL_URL}'; });`
const STYLE = 'body{font:16px system-ui;margin:24px;display:flex;flex-direction:column;height:calc(100vh - 48px);box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;flex:1;min-height:80px;border:1px solid #888;padding:12px;font:inherit}footer{display:flex;gap:24px;padding:12px}a{padding:12px;color:#0645ad}h1{font-size:22px}p{margin:4px 0}'

/** Static local content only; message data is decoded as text, never HTML or script. */
export function slackConfirmationOptions(review: SlackSendConfirmation): { title: string; url: string; detail: string } {
  const destination = `Destination: ${slackDestinationLabel(review.destination)}`
  const account = `Account: ${review.teamId} / ${review.userId}`
  const payload = encodeURIComponent(JSON.stringify({ destination, account, text: review.text }))
  const csp = `default-src 'none'; script-src '${hash(SCRIPT)}'; style-src '${hash(STYLE)}'; base-uri 'none'; form-action 'none'`
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Confirm Slack message</title><style>${STYLE}</style><body><h1>Send this message to Slack?</h1><p id="destination"></p><p id="account"></p><pre id="text" tabindex="0" aria-label="Complete message"></pre><footer><a id="cancel" href="${CONFIRM_CANCEL_URL}">Cancel</a><a href="${CONFIRM_SEND_URL}">Send</a></footer><script>${SCRIPT}</script></body></html>`
  return { title: 'Confirm Slack message', url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}#${payload}`, detail: `${destination}\n${account}\n\n${review.text}` }
}

function hash(value: string): string {
  return `sha256-${createHash('sha256').update(value).digest('base64')}`
}

/** Closing, cancellation, and repeated decisions cannot approve a later request. */
export function oneShotConfirmation(resolve: (approved: boolean) => void): (approved: boolean) => void {
  let pending = true
  return (approved) => {
    if (!pending) return
    pending = false
    resolve(approved)
  }
}
