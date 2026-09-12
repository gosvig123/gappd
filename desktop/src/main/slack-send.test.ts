import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SLACK_SEND_TEXT_MAX_LENGTH } from '../shared/slack-contract.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SLACK_POST_MESSAGE_URL } from './slack-send.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { CHANNEL_ID, NOW, REVIEW_ID, createHarness, deferred, tokens } from './slack-send-harness.ts'

test('review rejects invalid input before any request exists', async () => {
  const { service, calls } = createHarness()
  await assert.rejects(service.review({ destination: 'not-a-destination', text: 'hello' }), /Slack channel ID/)
  await assert.rejects(service.review({ destination: CHANNEL_ID, text: '   ' }), /Enter a message/)
  await assert.rejects(service.review({ destination: CHANNEL_ID, text: 'x'.repeat(SLACK_SEND_TEXT_MAX_LENGTH + 1) }), /too long/)
  await assert.rejects(service.review({ destination: CHANNEL_ID, text: '&'.repeat(SLACK_SEND_TEXT_MAX_LENGTH) }), /escaped/)
  await assert.rejects(service.review(undefined), /Slack channel ID/)
  assert.equal(calls.length, 0)
})

test('review refuses when Slack is not connected', async () => {
  const { service, calls } = createHarness({ tokens: null })
  await assert.rejects(service.review({ destination: CHANNEL_ID, text: 'hello' }), /not connected/)
  assert.equal(calls.length, 0)
})

test('review binds the message, destination, and account to the review id', async () => {
  const { service } = createHarness()
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  assert.equal(review.id, REVIEW_ID)
  assert.deepEqual(review, { id: REVIEW_ID, destination: { channelId: CHANNEL_ID, threadTs: null }, teamId: 'T0C19BLLJBX', userId: 'U00000001', text: 'hello' })
})

test('send posts once per review and confirmation', async () => {
  const { service, calls } = createHarness()
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  assert.deepEqual(await service.send(review.id), { status: 'sent', channelId: CHANNEL_ID, ts: '1750000000.123456', messageLink: `https://slack.com/app_redirect?channel=${CHANNEL_ID}&message_ts=1750000000.123456` })
  await assert.rejects(service.send(review.id), /Review the message/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, SLACK_POST_MESSAGE_URL)
  assert.equal(calls[0]?.authorization, 'Bearer xoxe.xoxp-1-old')
  assert.equal(calls[0]?.body.channel, CHANNEL_ID)
})

test('send without a matching review does not post', async () => {
  const first = createHarness()
  await assert.rejects(first.service.send(REVIEW_ID), /Review the message/)
  const second = createHarness()
  await second.service.review({ destination: CHANNEL_ID, text: 'hello' })
  await assert.rejects(second.service.send('other-review'), /Review the message/)
  assert.equal(first.calls.length + second.calls.length, 0)
})

test('a cancelled confirmation posts nothing and consumes the review', async () => {
  const confirms: unknown[] = []
  const { service, calls } = createHarness({ confirm: async (review) => { confirms.push(review); return false } })
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  assert.deepEqual(await service.send(review.id), { status: 'cancelled' })
  await assert.rejects(service.send(review.id), /Review the message/)
  assert.equal(confirms.length, 1)
  assert.deepEqual(confirms[0], { destination: { channelId: CHANNEL_ID, threadTs: null }, teamId: 'T0C19BLLJBX', userId: 'U00000001', text: 'hello' })
  assert.equal(calls.length, 0)
})

test('send rejects a second attempt while one is being confirmed', async () => {
  const gate = deferred<boolean>()
  const { service, calls } = createHarness({ confirm: () => gate.promise })
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  const first = service.send(review.id)
  await assert.rejects(service.send(review.id), /already being sent/)
  gate.resolve(true)
  assert.equal((await first).status, 'sent')
  assert.equal(calls.length, 1)
})

test('a disconnect after review blocks the send before confirmation', async () => {
  const confirms: unknown[] = []
  const { service, connection, calls } = createHarness({ confirm: async (review) => { confirms.push(review); return true } })
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  await connection.disconnect()
  await assert.rejects(service.send(review.id), /connection changed/)
  assert.equal(confirms.length, 0)
  assert.equal(calls.length, 0)
})

test('a reconnect during the confirmation blocks the send', async () => {
  const gate = deferred<void>()
  const started = deferred<void>()
  const { service, connection, calls } = createHarness({ confirm: async () => { started.resolve(); await gate.promise; return true } })
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  const sending = service.send(review.id)
  await started.promise
  await connection.connect()
  gate.resolve()
  await assert.rejects(sending, /connection changed/)
  assert.equal(calls.length, 0)
})

test('a changed account after review blocks the send', async () => {
  const { service, store, calls } = createHarness()
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  store.state.value = tokens({ teamId: 'T0OTHER0000', userId: 'U00000002' })
  await assert.rejects(service.send(review.id), /connection changed/)
  assert.equal(calls.length, 0)
})

test('a rotated token for the reviewed account is used', async () => {
  const { service, store, calls } = createHarness({ tokens: { expiresAt: NOW + 60_000 } })
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  assert.equal((await service.send(review.id)).status, 'sent')
  assert.equal(store.state.writes.length, 1)
  assert.equal(calls[0]?.authorization, 'Bearer xoxe.xoxp-1-new')
})

test('a failed send result never contains tokens or message text', async () => {
  const body = 'secret-message-<@U00000002>'
  const { service, calls } = createHarness({ respond: () => new Response('', { status: 503 }) })
  const review = await service.review({ destination: CHANNEL_ID, text: body })
  const result = await service.send(review.id)
  assert.equal(result.status, 'failed')
  assert.equal(result.outcome, 'unknown')
  assert.equal(JSON.stringify(result).includes('xoxe'), false)
  assert.equal(JSON.stringify(result).includes('secret-message'), false)
  assert.equal(calls.length, 1)
})

 test('direct connect invalidates an existing review without disconnect', async () => {
  const { service, connection, calls } = createHarness()
  const review = await service.review({ destination: CHANNEL_ID, text: 'hello' })
  await connection.connect()
  await assert.rejects(service.send(review.id), /connection changed/)
  assert.equal(calls.length, 0)
})
