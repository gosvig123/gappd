import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { SLACK_REDIRECT_URI, SLACK_USER_SCOPES } from './slack-oauth.ts'

const RAW = readFileSync(new URL('../../../slack-app/manifest.json', import.meta.url), 'utf8')
const MANIFEST = JSON.parse(RAW)

test('manifest matches the desktop redirect and user scopes', () => {
  assert.equal(MANIFEST.display_information.name, 'Gappd')
  assert.deepEqual(MANIFEST.oauth_config.redirect_urls, [SLACK_REDIRECT_URI])
  const redirect = new URL(MANIFEST.oauth_config.redirect_urls[0])
  assert.equal(redirect.hostname, 'localhost')
  assert.equal(redirect.pathname, '/slack/oauth/callback')
  assert.deepEqual(MANIFEST.oauth_config.scopes.user, SLACK_USER_SCOPES)
  assert.deepEqual(MANIFEST.oauth_config.scopes.bot || [], [])
  assert.ok(!MANIFEST.oauth_config.scopes.user.includes('search:read'))
})

test('manifest keeps PKCE, rotation, and unused capabilities off', () => {
  assert.equal(MANIFEST.oauth_config.pkce_enabled, true)
  assert.equal(MANIFEST.settings.token_rotation_enabled, true)
  assert.equal(MANIFEST.settings.socket_mode_enabled, false)
  assert.equal(MANIFEST.settings.org_deploy_enabled, false)
  assert.equal('interactivity' in MANIFEST.settings, false)
  assert.equal('event_subscriptions' in MANIFEST.settings, false)
})

test('manifest contains no secrets', () => {
  assert.equal(RAW.toLowerCase().includes('secret'), false)
  assert.equal(RAW.includes('xox'), false)
})
