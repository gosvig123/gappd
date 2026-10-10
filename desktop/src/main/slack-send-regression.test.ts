import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { CHANNEL_ID, TEAM_ID, MESSAGE_TS, createHarness } from './slack-send-harness.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { parseSlackDestination } from './slack-destination.ts'

const CLIENT = `https://app.slack.com/client/${TEAM_ID}/${CHANNEL_ID}`

test('client query thread parent reaches the post payload', async () => {
  const { service, calls } = createHarness()
  const review = await service.review({ destination: `${CLIENT}?thread_ts=${MESSAGE_TS}&cid=${CHANNEL_ID}`, text: 'reply' })
  await service.send(review.id)
  assert.equal(calls[0].body.thread_ts, MESSAGE_TS)
  assert.equal(calls[0].body.reply_broadcast, false)
})

test('client links reject malformed or conflicting thread destinations', () => {
  for (const suffix of ['?thread_ts=', '?thread_ts=bad', '?cid=C00000000', '?thread_ts=1&thread_ts=2',
    `/thread/${CHANNEL_ID}-${MESSAGE_TS}?thread_ts=1749999999.123456`, '/thread/C00000000-1750000000.123456']) {
    assert.throws(() => parseSlackDestination(CLIENT + suffix, TEAM_ID))
  }
  assert.equal(parseSlackDestination(`${CLIENT}/thread/${CHANNEL_ID}-${MESSAGE_TS}?thread_ts=${MESSAGE_TS}`, TEAM_ID).threadTs, MESSAGE_TS)
})

test('malformed JSON envelopes and non-200 success bodies remain unknown', async () => {
  const envelopes = [{}, [], true, null, { ok: 'true' }, { ok: false }, { ok: false, error: '' }, { ok: false, error: 3 }, { ok: false, error: ' ' }, { ok: false, error: '_' }]
  const cases = envelopes.map((value) => ({ value, status: 200 }))
  cases.push(...[201, 400, 302].map((status) => ({ value: { ok: true, channel: CHANNEL_ID, ts: MESSAGE_TS }, status })))
  for (const { value, status } of cases) {
    const { service, calls } = createHarness({ respond: () => Response.json(value, { status }) })
    const result = await service.send((await service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
    assert.equal(result.status, 'failed')
    if (result.status === 'failed') assert.equal(result.outcome, 'unknown')
    assert.equal(calls.length, 1)
  }
})

test('redirect rejection uses redirect:error and never retries', async () => {
  const { service, calls } = createHarness({ respond: (call) => {
    assert.equal(call.redirect, 'error')
    throw new TypeError('redirect rejected')
  } })
  const result = await service.send((await service.review({ destination: CHANNEL_ID, text: 'hello' })).id)
  assert.equal(calls.length, 1)
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.outcome, 'unknown')
})
