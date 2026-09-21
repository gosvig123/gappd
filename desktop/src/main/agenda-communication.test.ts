import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { gmailAgenda } from './gmail-agenda.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { slackAgenda, agendaSlackChannels } from './slack-agenda.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection } from './slack-connection.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GoogleCalendarServiceCore } from './google-calendar-service-core.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { GMAIL_READ_SCOPE, communicationJSON } from './agenda-communication.ts'
import type { CalendarDocument } from './google-calendar-service-core'

const now = Date.now()
const ts = `${Math.floor(now / 1000) - 60}.000001`
const later = `${Math.floor(now / 1000) - 30}.000001`
const slackTokens = { scope: 'users:read.email,im:history,channels:history', accessToken: 'test-slack-token', refreshToken: 'test-refresh', expiresAt: now + 3600000, refreshExpiresAt: now + 86400000, teamId: 'T123456789', userId: 'U123456789' }

function slackConnection() {
  let tokens: typeof slackTokens | null = slackTokens
  return new SlackConnection('test-client', { read: async () => tokens, write: async value => { tokens = value }, clear: async () => { tokens = null } }, { openExternal: async () => {} })
}

/** Only the external network boundary is replaced; requests use a real HTTP server. */
async function withHTTP(route: (url: URL) => unknown, run: (fetcher: typeof fetch, urls: URL[]) => Promise<void>) {
  const urls: URL[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture')
    urls.push(url)
    assert.equal(req.method, 'GET')
    assert.match(req.headers.authorization ?? '', /^Bearer test-/)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(route(url)))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input))
    assert.ok(['gmail.googleapis.com', 'slack.com'].includes(url.hostname))
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init)
  }
  try { await run(fetcher, urls) }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

test('Gmail reads invitee communication from this account, follows pages, and keeps exact plain text', async () => {
  await withHTTP(url => {
    if (url.pathname.endsWith('/messages')) return url.searchParams.get('pageToken') ? { messages: [{ id: 'bb' }] } : { messages: [{ id: 'aa' }], nextPageToken: 'page2' }
    return { id: url.pathname.split('/').pop(), internalDate: String(now - 60000), payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Launch' }, { name: 'From', value: 'guest@example.com' }], parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Please confirm the launch review date.').toString('base64url') } },
      { filename: 'private.txt', mimeType: 'text/plain', body: { data: Buffer.from('ATTACHMENT MUST NOT BE READ').toString('base64url') } },
      { mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { data: Buffer.from('EMPTY FILENAME ATTACHMENT').toString('base64url') } },
    ] } }
  }, async (fetcher, urls) => {
    const result = await gmailAgenda('test-gmail-token', 'account', ['Guest@example.com'], now, fetcher)
    assert.equal(result.sources.length, 2)
    assert.equal(result.sources[0].id, 'gmail:account:aa')
    assert.match(result.sources[0].text, /Please confirm the launch review date\./)
    assert.doesNotMatch(result.sources[0].text, /ATTACHMENT/)
    assert.match(urls[0].searchParams.get('q')!, /from:guest@example.com to:guest@example.com cc:guest@example.com bcc:guest@example.com/)
    assert.match(urls[0].searchParams.get('q')!, /after:\d+ before:\d+/)
    assert.ok(urls.every(url => url.pathname.startsWith('/gmail/v1/users/me/messages')))
  })
})

test('Slack reads only existing invitee DMs and selected joined channels, including replies', async () => {
  await withHTTP(url => {
    const method = url.pathname.split('/').pop()
    if (method === 'users.lookupByEmail') return { ok: true, user: { id: 'U987654321' } }
    if (method === 'users.conversations') return { ok: true, channels: [{ id: 'D123456789', user: 'U987654321', is_im: true }, { id: 'D999999999', user: 'U999999999', is_im: true }] }
    if (method === 'conversations.info') return { ok: true, channel: { id: 'C123456789', name: 'launch', is_member: true } }
    if (method === 'conversations.history') return { ok: true, messages: [{ ts, user: 'U987654321', text: 'Please confirm the launch review date.', reply_count: 1 }] }
    if (method === 'conversations.replies') return { ok: true, messages: [{ ts, text: 'Please confirm the launch review date.' }, { ts: later, text: 'The launch review was completed today.' }] }
    assert.fail(`Unexpected Slack method: ${method}`)
  }, async (fetcher, urls) => {
    const result = await slackAgenda(slackConnection(), ['guest@example.com'], ['C123456789'], now, fetcher)
    assert.equal(result.sources.length, 4)
    assert.ok(result.sources.some(source => source.text.includes('completed today')))
    assert.ok(result.sources.every(source => source.id.startsWith('slack:T123456789:')))
    assert.ok(urls.filter(url => url.pathname.endsWith('/conversations.history')).every(url => ['D123456789', 'C123456789'].includes(url.searchParams.get('channel')!)))
    assert.match(result.warning!, /Older messages/)
  })
})

test('Slack never opens a missing DM and fails safely on scope, membership, or account changes', async () => {
  const connection = slackConnection()
  const calls: string[] = []
  const missing: typeof fetch = async input => {
    calls.push(String(input))
    return Response.json({ ok: false, error: 'users_not_found' })
  }
  assert.deepEqual((await slackAgenda(connection, ['guest@example.com'], [], now, missing)).sources, [])
  assert.equal(calls.length, 1)
  await assert.rejects(slackAgenda(connection, [], ['C123456789'], now, async () => Response.json({ ok: false, error: 'missing_scope' })), /Reconnect Slack/)
  await assert.rejects(slackAgenda(connection, [], ['C123456789'], now, async () => Response.json({ ok: true, channel: { id: 'C123456789', is_member: false } })), /joined/)
  await assert.rejects(slackAgenda(connection, ['guest@example.com'], [], now, async () => { await connection.disconnect(); return Response.json({ ok: true, user: { id: 'U987654321' } }) }), /connection changed/)
  assert.throws(() => agendaSlackChannels(['https://attacker.test']), /channel IDs/)
})

test('Slack honors short rate limits once and rejects unbounded waits', async () => {
  let requests = 0
  await slackAgenda(slackConnection(), ['guest@example.com'], [], now, async () => ++requests === 1
    ? Response.json({ ok: false, error: 'ratelimited' }, { status: 429, headers: { 'retry-after': '0' } })
    : Response.json({ ok: false, error: 'users_not_found' }))
  assert.equal(requests, 2)
  await assert.rejects(slackAgenda(slackConnection(), ['guest@example.com'], [], now, async () => Response.json({ ok: false, error: 'ratelimited' }, { status: 429, headers: { 'retry-after': '999' } })), /Try again in 999 seconds/)
})

test('Gmail access is opt-in, account-bound, and refreshed tokens are saved before reads', async () => {
  const tokens = { accessToken: 'test-old', refreshToken: 'refresh', expiresAt: 0, tokenType: 'Bearer', scope: '' }
  let document: CalendarDocument = { version: 1, connections: [{ id: 'one', subject: 'subject', email: 'self@example.com', tokens, events: [] }] }
  const core = new GoogleCalendarServiceCore({ configured: () => true, authorize: async () => { throw new Error('not used') }, sync: async () => { throw new Error('not used') }, revoke: async () => {}, refresh: async value => ({ ...value, accessToken: 'test-new' }) }, { read: async () => structuredClone(document), write: async value => { document = value } })
  let reads = 0
  const read = async (token: string, subject: string) => { reads++; assert.equal(token, document.connections[0].tokens.accessToken); assert.equal(subject, 'subject'); return { sources: [] } }
  assert.match((await core.agendaCommunication('one', read)).warning!, /not read/)
  assert.equal(reads, 0)
  document.connections[0].tokens.scope = GMAIL_READ_SCOPE
  const context = await core.agendaCommunication('one', read)
  assert.equal(reads, 1)
  context.assertCurrent?.()
  await core.disconnect('one')
  assert.throws(() => context.assertCurrent?.(), /connection changed/)
  await assert.rejects(core.agendaCommunication('one', read), /not found/)
})

test('malformed Gmail MIME is rejected and invalid Slack timestamps never reach replies', async () => {
  for (const payload of [{ parts: {} }, { headers: [{ name: 42, value: 'bad' }] }]) {
    await assert.rejects(gmailAgenda('test-token', 'account', ['guest@example.com'], now, async input => Response.json(String(input).includes('/messages/aa?') ? { id: 'aa', internalDate: String(now - 60000), payload } : { messages: [{ id: 'aa' }] })), /invalid MIME/)
  }
  let replies = 0
  await assert.rejects(slackAgenda(slackConnection(), [], ['C123456789'], now, async input => {
    const method = new URL(String(input)).pathname.split('/').pop()
    if (method === 'conversations.info') return Response.json({ ok: true, channel: { id: 'C123456789', is_member: true } })
    if (method === 'conversations.replies') replies++
    return Response.json({ ok: true, messages: [{ text: 'bad timestamp', reply_count: 1 }] })
  }), /Slack agenda read failed/)
  assert.equal(replies, 0)
})

test('communication errors do not expose response text; malformed addresses never reach a service', async () => {
  await assert.rejects(communicationJSON(new Response('secret-response')), /invalid or oversized/)
  await assert.rejects(communicationJSON(new Response('x'.repeat(1024 * 1024 + 1))), /invalid or oversized/)
  await assert.rejects(gmailAgenda('test-token', 'account', ['guest@example.com OR anything'], now, async () => { assert.fail('must not fetch') }), /valid invitee/)
  await assert.rejects(gmailAgenda('test-token', 'account', ['guest@example.com'], now, async () => new Response('secret-token', { status: 403 })), /Gmail agenda access is unavailable/)
})
