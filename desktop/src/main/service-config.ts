declare const __GAPPD_CLERK_ISSUER__: string
declare const __GAPPD_CLERK_OAUTH_CLIENT_ID__: string
declare const __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: string

export type ServiceConfig = {
  clerkIssuer: string
  clerkClientId: string
  googleClientId: string
}

export function serviceConfig(): ServiceConfig {
  return {
    clerkIssuer: configuredValue('__GAPPD_CLERK_ISSUER__', process.env.GAPPD_CLERK_ISSUER),
    clerkClientId: configuredValue('__GAPPD_CLERK_OAUTH_CLIENT_ID__', process.env.GAPPD_CLERK_OAUTH_CLIENT_ID),
    googleClientId: configuredValue('__GAPPD_GOOGLE_OAUTH_CLIENT_ID__', process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID),
  }
}

function configuredValue(name: string, runtimeValue?: string): string {
  const buildValue = buildConfigValue(name)
  return buildValue || runtimeValue?.trim() || ''
}

function buildConfigValue(name: string): string {
  if (name === '__GAPPD_CLERK_ISSUER__' && typeof __GAPPD_CLERK_ISSUER__ === 'string') return __GAPPD_CLERK_ISSUER__
  if (name === '__GAPPD_CLERK_OAUTH_CLIENT_ID__' && typeof __GAPPD_CLERK_OAUTH_CLIENT_ID__ === 'string') return __GAPPD_CLERK_OAUTH_CLIENT_ID__
  if (name === '__GAPPD_GOOGLE_OAUTH_CLIENT_ID__' && typeof __GAPPD_GOOGLE_OAUTH_CLIENT_ID__ === 'string') return __GAPPD_GOOGLE_OAUTH_CLIENT_ID__
  return ''
}
