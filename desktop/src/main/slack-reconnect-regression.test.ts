import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { createHarness, deferred, tokenPayload, NOW } from './slack-send-harness.ts'

test('a pending old refresh cannot overwrite direct reconnect tokens', async () => {
  const gate = deferred<Response>()
  const started = deferred<void>()
  const { connection, store } = createHarness({ tokens: { expiresAt: NOW }, refreshTokens: () => { started.resolve(); return gate.promise } })
  const refresh = connection.accessToken()
  await started.promise
  await connection.connect()
  gate.resolve(tokenPayload({ accessToken: 'old-refresh-result' }))
  await assert.rejects(refresh, /disconnected during refresh/)
  assert.equal(store.state.value?.accessToken, 'xoxe.xoxp-1-new')
  assert.equal(store.state.writes.length, 1)
})

// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection } from './slack-connection.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { CLIENT_ID, tokens } from './slack-send-harness.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { completeSlackAuthorization } from './slack-oauth.ts'

test('an older pending connect cannot overwrite the newer account', async () => {
  const gate = deferred<Response>()
  const started = deferred<void>()
  let value = tokens()
  let requests = 0
  const store = { read: async () => value, write: async (next: typeof value) => { value = next }, clear: async () => {} }
  const connection = new SlackConnection(CLIENT_ID, store, {
    now: () => NOW, openExternal: finishAuthorization,
    fetcher: async () => { if (++requests === 1) { started.resolve(); return gate.promise }; return tokenPayload({ userId: 'U00000002' }) },
  })
  const oldConnect = connection.connect()
  await started.promise
  await connection.connect()
  gate.resolve(tokenPayload())
  await assert.rejects(oldConnect, /disconnected during connect/)
  assert.equal(value.userId, 'U00000002')
})

async function finishAuthorization(input: string): Promise<void> {
  const url = new URL(input)
  const callback = new URL(url.searchParams.get('redirect_uri')!)
  callback.searchParams.set('code', 'test-code')
  callback.searchParams.set('state', url.searchParams.get('state')!)
  assert.equal(completeSlackAuthorization(callback.href), true)
}
