declare const __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: string
declare const __GAPPD_SLACK_OAUTH_CLIENT_ID__: string

const DEFAULT_GOOGLE_RELAY_URL = 'https://auth.getgappd.com'
const DEFAULT_SLACK_CLIENT_ID = '12043394698405.12046083998246'

export type ServiceConfig = {
  googleClientId: string
  googleRelayUrl: string
  slackClientId: string
}

export function serviceConfig(): ServiceConfig {
  return {
    googleClientId: buildGoogleClientId() || process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID?.trim() || '',
    googleRelayUrl: process.env.GAPPD_GOOGLE_OAUTH_RELAY_URL?.trim() || DEFAULT_GOOGLE_RELAY_URL,
    slackClientId: buildSlackClientId() || process.env.GAPPD_SLACK_OAUTH_CLIENT_ID?.trim() || DEFAULT_SLACK_CLIENT_ID,
  }
}

function buildGoogleClientId(): string {
  return typeof __GAPPD_GOOGLE_OAUTH_CLIENT_ID__ === 'string' ? __GAPPD_GOOGLE_OAUTH_CLIENT_ID__.trim() : ''
}

function buildSlackClientId(): string {
  return typeof __GAPPD_SLACK_OAUTH_CLIENT_ID__ === 'string' ? __GAPPD_SLACK_OAUTH_CLIENT_ID__.trim() : ''
}

/** Explicit development identity only. Production must supply a separately reviewed configuration. */
export function cloudAuthDevelopmentConfig() {
  return { issuer: 'https://learning-mutt-4805.clerk.accounts.dev', clientId: 'iFaeusoYBwClQRoP' }
}

const DEFAULT_CLOUD_RESOURCE = 'https://gappd-cloud-api-production.up.railway.app/mcp'

/** The Upload API and the MCP endpoint share one origin and one canonical resource URL. */
export function cloudResource(): string {
  return process.env.GAPPD_CLOUD_RESOURCE_URL?.trim() || DEFAULT_CLOUD_RESOURCE
}
