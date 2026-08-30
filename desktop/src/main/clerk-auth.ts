import { shell } from 'electron'
import type { ClerkAccountStatus, ClerkUserSummary } from '../shared/account-contract'
import { createSecureStore } from './electron-secure-store'
import { authorizeOAuth, type OAuthConfig, type OAuthTokenSet } from './oauth'
import { serviceConfig } from './service-config'

const CLERK_STORE_FILE = 'clerk-account.enc'
const CLERK_CALLBACK_PATH = '/callback'
const CLERK_SCOPES = ['email', 'profile', 'offline_access']

type ClerkDocument = { version: 1; tokens: OAuthTokenSet; user: ClerkUserSummary }
let connecting: Promise<ClerkAccountStatus> | null = null

export async function clerkAccountStatus(): Promise<ClerkAccountStatus> {
  const configured = Boolean(clerkOAuthConfig())
  if (!configured) return { configured: false, connected: false }
  const document = await createSecureStore<ClerkDocument>(CLERK_STORE_FILE).read()
  return { configured: true, connected: Boolean(document), user: document?.user }
}

export function connectClerkAccount(): Promise<ClerkAccountStatus> {
  if (!connecting) connecting = performClerkConnect().finally(() => { connecting = null })
  return connecting
}

export async function disconnectClerkAccount(): Promise<ClerkAccountStatus> {
  const store = createSecureStore<ClerkDocument>(CLERK_STORE_FILE)
  const document = await store.read()
  if (document) await revokeBestEffort(document.tokens)
  await store.clear()
  return clerkAccountStatus()
}

async function performClerkConnect(): Promise<ClerkAccountStatus> {
  const config = clerkOAuthConfig()
  if (!config) throw new Error('Clerk is not configured for this build.')
  const tokens = await authorizeOAuth(config, { openExternal: (url) => shell.openExternal(url) })
  const user = await fetchClerkUser(config, tokens)
  await createSecureStore<ClerkDocument>(CLERK_STORE_FILE).write({ version: 1, tokens, user })
  return { configured: true, connected: true, user }
}

async function fetchClerkUser(config: OAuthConfig, tokens: OAuthTokenSet): Promise<ClerkUserSummary> {
  const issuer = new URL(config.authorizeUrl).origin
  const response = await fetch(`${issuer}/oauth/userinfo`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })
  if (!response.ok) throw new Error(`Clerk profile request failed (${response.status}).`)
  return mapClerkUser(await response.json() as Record<string, unknown>)
}

function mapClerkUser(value: Record<string, unknown>): ClerkUserSummary {
  const id = requiredString(value.sub, 'Clerk user ID')
  const email = requiredString(value.email || value.email_address, 'Clerk email')
  const name = optionalString(value.name) || joinedName(value)
  return name ? { id, email, name } : { id, email }
}

async function revokeBestEffort(tokens: OAuthTokenSet): Promise<void> {
  const config = clerkOAuthConfig()
  if (!config) return
  const token = tokens.refreshToken || tokens.accessToken
  const issuer = new URL(config.authorizeUrl).origin
  try { await fetch(`${issuer}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, client_id: config.clientId }) }) }
  catch { /* Local sign-out must still succeed. */ }
}

function clerkOAuthConfig(): OAuthConfig | null {
  const config = serviceConfig()
  if (!config.clerkIssuer || !config.clerkClientId) return null
  const issuer = trustedIssuer(config.clerkIssuer)
  return { clientId: config.clerkClientId, authorizeUrl: `${issuer}/oauth/authorize`, tokenUrl: `${issuer}/oauth/token`, scopes: CLERK_SCOPES, callbackPath: CLERK_CALLBACK_PATH }
}

function trustedIssuer(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Clerk issuer must use HTTPS.')
  return url.origin
}

function joinedName(value: Record<string, unknown>): string | undefined {
  const name = [optionalString(value.given_name), optionalString(value.family_name)].filter(Boolean).join(' ')
  return name || undefined
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} was missing from Clerk.`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
