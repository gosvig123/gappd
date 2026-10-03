import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { CHANNEL_ID, NOW, createHarness } from './slack-send-harness.ts'

const PARENT_TS = '1749999999.123456'

test('the payload disables markup and unfurls and escapes Slack control syntax', async () => {
  const { service, calls } = createHarness()
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello <@U00000002> & <!channel> > bye' })
  await service.send(review.id)
  assert.deepEqual(calls[0]?.body, {
    channel: CHANNEL_ID,
    text: 'hello &lt;@U00000002&gt; &amp; &lt;!channel&gt; &gt; bye',
    mrkdwn: false,
    unfurl_links: false,
    unfurl_media: false,
  })
})

test('a thread destination preserves the parent ts and never broadcasts', async () => {
  const link = `https://gappd.slack.com/archives/${CHANNEL_ID}/p1750000000123456?thread_ts=${PARENT_TS}&cid=${CHANNEL_ID}`
  const { service, calls } = createHarness()
  const review = await service.review({ destination: link, text: 'reply' })
  assert.deepEqual(review.destination, { channelId: CHANNEL_ID, threadTs: PARENT_TS })
  await service.send(review.id)
  assert.equal(calls[0]?.body.thread_ts, PARENT_TS)
  assert.equal(calls[0]?.body.reply_broadcast, false)
})

test('Slack errors become friendly not-sent messages without the message text', async () => {
  const cases = [
    ['not_in_channel', /not in that conversation/],
    ['missing_scope', /chat:write scope/],
    ['token_revoked', /Reconnect Slack/],
    ['is_archived', /archived/],
    ['channel_not_found', /could not find that channel/],
  ] as const
  for (const [code, expected] of cases) {
    const { service } = createHarness({ respond: () => Response.json({ ok: false, error: code }) })
    const review = await service.review({ destination: CHANNEL_ID, text: 'body-must-stay-private' })
    const result = await service.send(review.id)
    assert.equal(result.status, 'failed')
    if (result.status !== 'failed') continue
    assert.equal(result.outcome, 'not-sent')
    assert.match(result.message, expected)
    assert.equal(result.message.includes('body-must-stay-private'), false)
    assert.equal(result.message.includes('xoxe'), false)
  }
})

test('rate limiting honors Retry-After and does not retry', async () => {
  const seconds = createHarness({ respond: () => new Response('', { status: 429, headers: { 'retry-after': '30' } }) })
  const first = await seconds.service.send((await seconds.service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(first.status, 'failed')
  if (first.status === 'failed') {
    assert.equal(first.retryAfterSeconds, 30)
    assert.equal(first.outcome, 'not-sent')
    assert.match(first.message, /about 30 seconds/)
  }
  assert.equal(seconds.calls.length, 1)

  const date = createHarness({ now: () => NOW, respond: () => new Response('', { status: 429, headers: { 'retry-after': new Date(NOW + 45_000).toUTCString() } }) })
  const second = await date.service.send((await date.service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  if (second.status === 'failed') assert.equal(second.retryAfterSeconds, 45)
  assert.equal(date.calls.length, 1)
})

test('a network failure after the post is delivery-unknown', async () => {
  const { service, calls } = createHarness({ respond: () => { throw new Error('socket closed') } })
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  const result = await service.send(review.id)
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') {
    assert.equal(result.outcome, 'unknown')
    assert.match(result.message, /Check Slack/)
  }
  assert.equal(calls.length, 1)
})

test('an HTTP 5xx after the post is delivery-unknown', async () => {
  const { service } = createHarness({ respond: () => new Response('', { status: 503 }) })
  const result = await service.send((await service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.outcome, 'unknown')
})

test('an unreadable success response is delivery-unknown', async () => {
  const unreadable = createHarness({ respond: () => new Response('not json', { status: 200 }) })
  const first = await unreadable.service.send((await unreadable.service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(first.status, 'failed')
  if (first.status === 'failed') {
    assert.equal(first.outcome, 'unknown')
    assert.match(first.message, /Check Slack/)
  }
  const noReference = createHarness({ respond: () => Response.json({ ok: true }) })
  const second = await noReference.service.send((await noReference.service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(second.status, 'failed')
  if (second.status === 'failed') {
    assert.equal(second.outcome, 'unknown')
    assert.match(second.message, /no message reference/)
  }
})

test('fatal_error is delivery-unknown', async () => {
  const { service } = createHarness({ respond: () => Response.json({ ok: false, error: 'fatal_error' }) })
  const result = await service.send((await service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') {
    assert.equal(result.outcome, 'unknown')
    assert.match(result.message, /fatal_error/)
  }
})

test('success needs ok true plus a valid message reference', async () => {
  const good = createHarness()
  const sent = await good.service.send((await good.service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.deepEqual(sent, { status: 'sent', channelId: CHANNEL_ID, ts: '1750000000.123456', messageLink: `https://slack.com/app_redirect?channel=${CHANNEL_ID}&message_ts=1750000000.123456` })
  const wrongShape = createHarness({ respond: () => Response.json({ ok: true, channel: 'not-a-channel', ts: '1.2' }) })
  const result = await wrongShape.service.send((await wrongShape.service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(result.status, 'failed')
})

test('a rejection without a Slack envelope is unknown', async () => {
  const { service } = createHarness({ respond: () => new Response('', { status: 404 }) })
  const result = await service.send((await service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') {
    assert.equal(result.outcome, 'unknown')
    assert.match(result.message, /Check Slack/)
  }
})
