declare const __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: string

const DEFAULT_GOOGLE_RELAY_URL = 'https://auth.getgappd.com'

export type ServiceConfig = {
  googleClientId: string
  googleRelayUrl: string
}

export function serviceConfig(): ServiceConfig {
  return {
    googleClientId: buildGoogleClientId() || process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID?.trim() || '',
    googleRelayUrl: process.env.GAPPD_GOOGLE_OAUTH_RELAY_URL?.trim() || DEFAULT_GOOGLE_RELAY_URL,
  }
}

function buildGoogleClientId(): string {
  return typeof __GAPPD_GOOGLE_OAUTH_CLIENT_ID__ === 'string' ? __GAPPD_GOOGLE_OAUTH_CLIENT_ID__.trim() : ''
}
