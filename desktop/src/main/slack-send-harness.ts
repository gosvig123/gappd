// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackConnection } from './slack-connection.ts'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SlackSendService, type SlackSendConfirmation, type SlackSendDependencies } from './slack-send.ts'
import type { SlackTokenSet } from './slack-oauth'

export const CLIENT_ID = '1234567890.1234567890'
export const NOW = 1_788_000_000_000
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
export const TEAM_ID = 'T0C19BLLJBX'
export const CHANNEL_ID = 'C0C1C2FVC78'
export const MESSAGE_TS = '1750000000.123456'
export const REVIEW_ID = 'review-1'

export type PostCall = { redirect: RequestRedirect | undefined; url: string; authorization: string; body: Record<string, unknown> }

export type HarnessOptions = {
  tokens?: Partial<SlackTokenSet> | null
  confirm?: (review: SlackSendConfirmation) => Promise<boolean>
  respond?: (call: PostCall) => Response | Promise<Response>
  refreshTokens?: (refreshToken: string) => Response | Promise<Response>
  now?: () => number
}

export function createHarness(options: HarnessOptions = {}) {
  const store = memoryStore(options.tokens === null ? null : tokens(options.tokens))
  const calls: PostCall[] = []
  const connection = new SlackConnection(CLIENT_ID, store, {
    openExternal: completeBrowserAuthorization,
    fetcher: tokenFetcher(options),
    now: options.now || (() => NOW),
    callbackPort: 0,
  })
  return { service: new SlackSendService(connection, sendDependencies(options, calls)), connection, store, calls }
}

function sendDependencies(options: HarnessOptions, calls: PostCall[]): SlackSendDependencies {
  return {
    confirm: options.confirm || (async () => true),
    fetcher: async (input, init) => {
      const call: PostCall = {
        redirect: init?.redirect,
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') || '',
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      }
      calls.push(call)
      return options.respond ? options.respond(call) : Response.json({ ok: true, channel: CHANNEL_ID, ts: MESSAGE_TS })
    },
    now: options.now || (() => NOW),
    timeoutMs: 50,
    reviewId: () => REVIEW_ID,
  }
}

export function tokens(overrides: Partial<SlackTokenSet> = {}): SlackTokenSet {
  return {
    accessToken: 'xoxe.xoxp-1-old',
    refreshToken: 'xoxe-1-old',
    expiresAt: NOW + 10 * 60 * 1000,
    refreshExpiresAt: NOW + THIRTY_DAYS_MS,
    scope: 'chat:write',
    teamId: TEAM_ID,
    userId: 'U00000001',
    ...overrides,
  }
}

export function tokenPayload(overrides: { accessToken?: string; teamId?: string; userId?: string } = {}): Response {
  return Response.json({
    ok: true,
    team: { id: overrides.teamId || TEAM_ID, name: 'gappd' },
    authed_user: {
      id: overrides.userId || 'U00000001',
      scope: 'chat:write',
      access_token: overrides.accessToken || 'xoxe.xoxp-1-new',
      expires_in: 43_200,
      refresh_token: 'xoxe-1-new',
      token_type: 'user',
    },
  })
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function tokenFetcher(options: HarnessOptions): typeof fetch {
  return async (_input, init) => {
    const refreshToken = new URLSearchParams(String(init?.body)).get('refresh_token')
    if (refreshToken && options.refreshTokens) return options.refreshTokens(refreshToken)
    return tokenPayload()
  }
}

function memoryStore(initial: SlackTokenSet | null) {
  const state = { value: initial, writes: [] as SlackTokenSet[], clears: 0 }
  return {
    state,
    read: async () => state.value,
    write: async (value: SlackTokenSet) => { state.value = value; state.writes.push(value) },
    clear: async () => { state.value = null; state.clears += 1 },
  }
}

async function completeBrowserAuthorization(url: string): Promise<void> {
  const authorization = new URL(url)
  const callback = new URL(authorization.searchParams.get('redirect_uri') || '')
  callback.searchParams.set('code', 'slack-code')
  callback.searchParams.set('state', authorization.searchParams.get('state') || '')
  await fetch(callback)
}
