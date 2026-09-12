import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { parseSlackDestination } from './slack-destination.ts'

const TEAM = 'T0C19BLLJBX'
const CHANNEL = 'C0C1C2FVC78'
const PARENT_TS = '1749999999.123456'

test('accepts a bare channel ID', () => {
  assert.deepEqual(parseSlackDestination(CHANNEL, TEAM), { channelId: CHANNEL, threadTs: null })
  assert.deepEqual(parseSlackDestination(` ${CHANNEL} `, TEAM), { channelId: CHANNEL, threadTs: null })
})

test('accepts a channel link without a thread', () => {
  assert.deepEqual(parseSlackDestination(`https://gappd.slack.com/archives/${CHANNEL}`, TEAM), { channelId: CHANNEL, threadTs: null })
})

test('keeps the thread parent from a copied reply link', () => {
  const link = `https://gappd.slack.com/archives/${CHANNEL}/p1750000000123456?thread_ts=${PARENT_TS}&cid=${CHANNEL}`
  assert.deepEqual(parseSlackDestination(link, TEAM), { channelId: CHANNEL, threadTs: PARENT_TS })
})

test('turns a message link without thread_ts into a thread reply', () => {
  assert.deepEqual(parseSlackDestination(`https://gappd.slack.com/archives/${CHANNEL}/p1750000000123456`, TEAM), { channelId: CHANNEL, threadTs: '1750000000.123456' })
})

test('accepts a thread link from the connected workspace', () => {
  const link = `https://app.slack.com/client/${TEAM}/${CHANNEL}/thread/${CHANNEL}-${PARENT_TS}`
  assert.deepEqual(parseSlackDestination(link, TEAM), { channelId: CHANNEL, threadTs: PARENT_TS })
  assert.deepEqual(parseSlackDestination(`https://app.slack.com/client/${TEAM}/${CHANNEL}`, TEAM), { channelId: CHANNEL, threadTs: null })
})

test('rejects an identifiable link from another workspace', () => {
  assert.throws(() => parseSlackDestination(`https://app.slack.com/client/T0OTHER0000/${CHANNEL}`, TEAM), /different Slack workspace/)
})

test('rejects credentialed, insecure, and non-Slack links', () => {
  assert.throws(() => parseSlackDestination(`https://user:pass@gappd.slack.com/archives/${CHANNEL}`, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`http://gappd.slack.com/archives/${CHANNEL}`, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`https://gappd.slack.com:8443/archives/${CHANNEL}`, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`https://gappd.slack.com.evil.com/archives/${CHANNEL}`, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`https://evil.com/archives/${CHANNEL}`, TEAM), /Slack channel ID/)
})

test('rejects invalid IDs, endpoints, query parameters, and thread timestamps', () => {
  assert.throws(() => parseSlackDestination('c0c1c2fvc78', TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination('C12', TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination('X0C1C2FVC78', TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`https://gappd.slack.com/services/${CHANNEL}`, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`https://gappd.slack.com/archives/${CHANNEL}?foo=bar`, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination(`https://gappd.slack.com/archives/${CHANNEL}?thread_ts=1749999999`, TEAM), /invalid thread timestamp/)
  assert.throws(() => parseSlackDestination(`https://gappd.slack.com/archives/${CHANNEL}?cid=C0OTHER0000`, TEAM), /Slack channel ID/)
})

test('fails closed on non-string destinations', () => {
  assert.throws(() => parseSlackDestination(undefined, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination({ channelId: CHANNEL }, TEAM), /Slack channel ID/)
  assert.throws(() => parseSlackDestination('   ', TEAM), /Slack channel ID/)
})
