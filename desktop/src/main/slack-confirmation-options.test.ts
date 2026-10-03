import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { oneShotConfirmation, slackConfirmationOptions } from './slack-confirmation-options.ts'

const review = { destination: { channelId: 'C00000001', threadTs: null }, teamId: 'T00000001', userId: 'U00000001', text: '' }

test('confirmation retains all 4000 characters including suffix beyond 300', () => {
  const text = 'x'.repeat(3980) + '<script>suffix</script>'.slice(0, 20)
  const options = slackConfirmationOptions({ ...review, text })
  assert.ok(options.detail.endsWith(text))
  const payload = JSON.parse(decodeURIComponent(new URL(options.url).hash.slice(1)))
  assert.equal(payload.text, text)
  const changed = slackConfirmationOptions({ ...review, text: text.slice(0, -1) + 'Z' })
  assert.notEqual(options.url, changed.url)
  const html = decodeURIComponent(options.url.split('#')[0].split(',').slice(1).join(','))
  assert.ok(!html.includes(text))
  assert.match(html, /textContent = review.text/)
  assert.match(html, /overflow:auto/)
  assert.match(html, /default-src 'none'/)
})

test('confirmation cancellation and approval settle only once', () => {
  for (const first of [false, true]) {
    const decisions: boolean[] = []
    const settle = oneShotConfirmation((value: boolean) => decisions.push(value))
    settle(first)
    settle(!first)
    assert.deepEqual(decisions, [first])
  }
})
