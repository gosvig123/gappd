#!/usr/bin/env node
/**
 * Proves the whole upload path against the deployed service, without the app UI.
 *
 * It signs in with the Desktop public client, registers a device, exports one synthetic local
 * Meeting with the real exporter, signs the upload and sends it. Everything after the browser
 * sign-in is the same code the app uses: the device module is imported, not reimplemented.
 *
 *   node --experimental-strip-types scripts/cloud-upload-proof.ts
 *   ... --delete     remove the cloud copy afterwards, proving the delete path too
 *   ... --keep       keep the isolated profile for inspection
 *
 * The sign-in is the one step a script cannot do alone: the browser it opens must already have a
 * Clerk session, or you complete the sign-in once. Nothing else needs a human.
 */
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, randomBytes, randomUUID } from 'node:crypto'
import { realpathSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { createDeviceCredential, rawBase64, signDeviceRequest, type DeviceCredential } from '../desktop/src/main/meeting-device.ts'

const RESOURCE = process.env.GAPPD_CLOUD_RESOURCE_URL?.trim() || 'https://gappd-cloud-api-production.up.railway.app/mcp'
const ISSUER = process.env.GAPPD_CLERK_ISSUER_URL?.trim() || 'https://learning-mutt-4805.clerk.accounts.dev'
const CLIENT_ID = process.env.GAPPD_CLERK_CLIENT_ID?.trim() || 'iFaeusoYBwClQRoP'
const SCOPES = 'email profile meetings:sync'
// The cloud copy id is derived from the owner and this local id, and a deleted copy never returns.
// A fixed id would therefore let one --delete run consume the proof for a whole account forever.
const LOCAL_MEETING = randomUUID()
const BINARY = 'build/gappd'

type Tokens = { accessToken: string; email: string; subject: string }

function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

/**
 * Builds the exporter every run. Reusing whatever is in build/ would let the script prove a stale
 * binary, which is worse than the couple of seconds a warm build takes.
 */
function buildBinary(): string {
  const binary = path.join(process.cwd(), BINARY)
  log('building the gappd binary...')
  execFileSync('go', ['build', '-o', BINARY, './cmd/gappd'], { stdio: 'inherit' })
  return binary
}

/**
 * Adds this run's Meeting and one recorded turn to the fixture profile. Without the turn the
 * Meeting has no segments, so the document carries no transcript and the proof would skip the
 * part a citation depends on.
 */
function addTurn(profile: string): void {
  const database = new DatabaseSync(path.join(profile, 'backend-home', '.gappd', 'db.sqlite'))
  try {
    database.prepare(`INSERT INTO meetings (id,title,started_at,ended_at,transcript,summary)
      VALUES (?,?,?,?,?,?)`).run(LOCAL_MEETING, 'SYNTHETIC: cloud upload proof',
      '2026-09-14T12:00:00Z', '2026-09-14T12:31:00Z', '',
      'Fabricated Meeting used to prove the cloud upload path.')
    database.prepare(`INSERT INTO segments (id,meeting_id,start_sec,end_sec,text,speaker)
      VALUES (?,?,?,?,?,?)`).run('proof-turn-1', LOCAL_MEETING, 0, 4.5,
      'Proof: the transcript, its timestamps and its speaker label reach the cloud.', 'You')
  } finally {
    database.close()
  }
}

/** Creates one fabricated local Meeting and exports its version-1 document. */
function exportDocument(binary: string, revision: number): { document: string; profile: string } {
  // Bootstrap refuses an existing path, and the canonical path matters because a symlinked
  // profile is refused elsewhere in the project.
  const candidate = path.join(tmpdir(), `gappd-proof-${randomBytes(8).toString('hex')}`)
  execFileSync(binary, ['selected-fixture', 'bootstrap', candidate])
  const profile = realpathSync(candidate)
  addTurn(profile)
  const document = execFileSync(binary, ['meeting-document', 'export', LOCAL_MEETING, String(revision)], {
    env: { ...process.env, HOME: path.join(profile, 'backend-home') }, maxBuffer: 4 << 20,
  }).toString()
  return { document, profile }
}

/** Runs the authorization-code flow with PKCE and returns the tokens. */
async function signIn(): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')
  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') return response.writeHead(404).end()
      const error = url.searchParams.get('error')
      const returned = url.searchParams.get('code')
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('You can close this tab.')
      server.close()
      if (error) return reject(new Error(`authorization refused: ${error}`))
      if (url.searchParams.get('state') !== state) return reject(new Error('state mismatch'))
      returned ? resolve({ code: returned, redirectUri }) : reject(new Error('no code'))
    })
    let redirectUri = ''
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      // The exchange must repeat the exact redirect of the authorize call, port included.
      redirectUri = `http://127.0.0.1:${port}/callback`
      const authorize = new URL(`${ISSUER}/oauth/authorize`)
      authorize.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, code_challenge: challenge,
        code_challenge_method: 'S256', redirect_uri: redirectUri, state,
        scope: SCOPES, prompt: 'consent', resource: RESOURCE }).toString()
      log(`opening the browser to sign in as the Desktop client. Complete it if it asks.`)
      execFileSync('open', [authorize.toString()])
    })
    setTimeout(() => { server.close(); reject(new Error('sign-in timed out after 180s')) }, 180_000).unref()
  })
  const response = await fetch(`${ISSUER}/oauth/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: CLIENT_ID, code_verifier: verifier }) })
  if (!response.ok) throw new Error(`token exchange failed: ${response.status} ${await response.text()}`)
  const value = (await response.json()) as { access_token?: string }
  if (!value.access_token) throw new Error('token exchange returned no access token')
  const bearer = { Authorization: `Bearer ${value.access_token}`, 'Content-Type': 'application/json' }
  const info = await fetch(`${ISSUER}/oauth/userinfo`, { headers: bearer })
  const account = info.ok ? (await info.json()) as { email?: string; sub?: string } : {}
  return { accessToken: value.access_token, email: account.email || 'unknown', subject: account.sub || 'unknown' }
}

async function call(tokens: Tokens, pathname: string, body: string, signatures: Record<string, string>, method = 'POST'): Promise<{ status: number; value: unknown }> {
  const response = await fetch(new URL(pathname, RESOURCE), { method, body, redirect: 'error',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json', ...signatures },
    signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${pathname} returned ${response.status}: ${text.slice(0, 300)}`)
  return { status: response.status, value: text ? JSON.parse(text) : null }
}

/** The revision must rise when the document changes, because one revision means one document. */
function revisionArgument(): number {
  const raw = process.argv.find((value) => value.startsWith('--revision='))?.split('=')[1]
  if (raw === undefined) return 1
  const revision = Number(raw)
  if (!Number.isInteger(revision) || revision < 1) throw new Error('--revision must be a positive integer')
  return revision
}

async function main(): Promise<void> {
  const remove = process.argv.includes('--delete')
  const keep = process.argv.includes('--keep')
  const revision = revisionArgument()
  const binary = buildBinary()
  const { document, profile } = exportDocument(binary, revision)
  const parsed = JSON.parse(document) as { version: number; meeting_id: string; revision: number; turns: { text: string }[] }
  if (parsed.version !== 1 || parsed.meeting_id !== LOCAL_MEETING || parsed.revision !== revision || parsed.turns.length === 0) {
    throw new Error(`the exporter produced an unexpected document: ${document.slice(0, 200)}`)
  }
  log(`exported a ${document.length}-byte version-1 document with ${parsed.turns.length} turn(s)`)
  // A dry run checks the local half only, so CI can prove the exporter without a sign-in.
  if (process.argv.includes('--dry-run')) {
    if (!keep) rmSync(profile, { recursive: true, force: true })
    log('DRY RUN OK: the exporter produced a valid document and no request was sent')
    return
  }
  try {
    const tokens = await signIn()
    const credential: DeviceCredential = createDeviceCredential()
    const key = createPrivateKey(credential.privateKey)
    const registration = await call(tokens, '/device', JSON.stringify({ public_key: credential.publicKey }), {})
    log(`registered device ${(registration.value as { device_id?: string }).device_id} for ${tokens.email}`)
    const signatures = signDeviceRequest(credential, key, 'POST', '/meeting', Buffer.from(document, 'utf8'))
    const upload = await call(tokens, '/meeting', document, signatures)
    const accepted = upload.value as { id: string; revision: number; expires_at: string }
    log(`UPLOAD OK ${JSON.stringify({ subject: tokens.subject, email: tokens.email, cloud_id: accepted.id,
      revision: accepted.revision, expires_at: accepted.expires_at, bytes: document.length })}`)
    if (remove) {
      const body = JSON.stringify({ meeting_id: LOCAL_MEETING })
      const deletion = signDeviceRequest(credential, key, 'DELETE', '/meeting', Buffer.from(body, 'utf8'))
      await call(tokens, '/meeting', body, deletion, 'DELETE')
      log(`deleted the cloud copy ${accepted.id}`)
    } else {
      log(`read it back with the MCP tool: get_meeting({ id: "${accepted.id}" })`)
    }
  } finally {
    if (!keep) rmSync(profile, { recursive: true, force: true })
    else log(`kept the isolated profile at ${profile}`)
  }
}

main().catch((error) => {
  console.error(`upload proof failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
