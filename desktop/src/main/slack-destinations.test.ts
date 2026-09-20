import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { listSlackDestinations } from './slack-destinations.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { createHarness, deferred, CHANNEL_ID } from './slack-send-harness.ts'

const conversationPage = (channels: unknown[] = [], next_cursor = '') => Response.json({ ok: true, channels, response_metadata: { next_cursor } })

test('lists memberships with pagination and readable channel and DM labels using fixed read-only endpoints', async () => {
  const { connection } = createHarness()
  const requests: URL[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url)
    assert.equal(url.origin, 'https://slack.com')
    assert.equal(init?.method ?? 'GET', 'GET')
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer xoxe.xoxp-1-old')
    assert.equal(url.searchParams.has('token'), false)
    if (url.pathname === '/api/users.info') {
      assert.equal(url.searchParams.get('user'), 'U00000002')
      return Response.json({ ok: true, user: { profile: { display_name: 'Alex' } } })
    }
    assert.equal(url.pathname, '/api/users.conversations')
    assert.equal(url.searchParams.get('exclude_archived'), 'true')
    assert.equal(url.searchParams.get('types'), 'public_channel,private_channel,im,mpim')
    assert.equal(url.searchParams.get('cursor'), 'next=page')
    return conversationPage([
      { id: CHANNEL_ID, name: 'beta' }, { id: 'G00000001', name: 'private', is_private: true },
      { id: 'D00000001', user: 'U00000002', is_im: true },
      { id: 'G00000002', name: 'group', is_mpim: true },
      { id: 'C00000003', name: 'archive', is_archived: true }, { id: 'D00000004', is_user_deleted: true },
    ], 'last-page')
  }
  assert.deepEqual(await listSlackDestinations(connection, 'next=page', fetcher), { destinations: [
    { channelId: CHANNEL_ID, label: 'beta', kind: 'channel' },
    { channelId: 'G00000001', label: 'private', kind: 'private-channel' },
    { channelId: 'D00000001', label: 'Alex', kind: 'dm' },
    { channelId: 'G00000002', label: 'group', kind: 'group-dm' },
  ], nextCursor: 'last-page' })
  assert.equal(requests.length, 2)
})

test('rejects invalid cursors and missing connections before requesting Slack', async () => {
  const { connection } = createHarness()
  const noRequest: typeof fetch = async () => { assert.fail('must not request Slack') }
  for (const cursor of [null, 1, {}, '\n', 'x'.repeat(2049)]) await assert.rejects(listSlackDestinations(connection, cursor, noRequest), /Invalid Slack page/)
  await connection.disconnect()
  await assert.rejects(listSlackDestinations(connection, '', noRequest), /not connected/)
})

test('gives safe reconnect, retry and rate-limit guidance without exposing Slack payloads', async () => {
  const { connection } = createHarness()
  for (const [response, expected] of [
    [Response.json({ ok: false, error: 'missing_scope' }), /Reconnect Slack to grant/],
    [Response.json({ ok: false, error: 'token_revoked' }), /authorization expired/],
    [new Response('private-token', { status: 429, headers: { 'retry-after': '30' } }), /30 seconds/],
    [new Response('private-token', { status: 502 }), /Could not load/],
    [Response.json({ ok: false, error: 'private-token' }), /Could not load/],
    [Response.json({ ok: true, channels: null }), /Could not load/],
    [conversationPage([{ id: 'https://attacker.example' }]), /Could not load/],
    [conversationPage([], '\n'), /Could not load/],
  ] as const) await assert.rejects(listSlackDestinations(connection, '', async () => response), expected)
  await assert.rejects(listSlackDestinations(connection, '', async () => { throw new Error('private-token') }), /Could not load/)
  await assert.rejects(listSlackDestinations(connection, 'same', async () => conversationPage([], 'same')), /Could not load/)
})

test('discards a page after disconnect or reconnect and does not look up names with the old account', async () => {
  for (const reconnect of [false, true]) {
    const { connection } = createHarness()
    const started = deferred<void>(), response = deferred<Response>()
    let requests = 0
    const pending = listSlackDestinations(connection, '', async () => { requests++; started.resolve(); return response.promise })
    await started.promise
    if (reconnect) await connection.connect()
    else await connection.disconnect()
    response.resolve(conversationPage([{ id: 'D00000001', is_im: true, user: 'U00000002' }]))
    await assert.rejects(pending, /connection changed/)
    assert.equal(requests, 1)
  }
})

test('rotates expired access tokens before listing and returns empty pages with a continuation', async () => {
  const { connection, store } = createHarness({ tokens: { expiresAt: 0 } })
  const result = await listSlackDestinations(connection, '', async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer xoxe.xoxp-1-new')
    return conversationPage([], 'continue')
  })
  assert.deepEqual(result, { destinations: [], nextCursor: 'continue' })
  assert.equal(store.state.writes.length, 1)
})
