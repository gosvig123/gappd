import { defineConfig } from 'tsup'

const googleClientId = process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID?.trim() || ''
// Google's Desktop client secret is not confidential in an installed app; Google needs it at the token endpoint.
const googleClientSecret = process.env.GAPPD_GOOGLE_OAUTH_CLIENT_SECRET?.trim() || ''
const slackClientId = process.env.GAPPD_SLACK_OAUTH_CLIENT_ID?.trim() || ''
// Packaged builds cannot rely on a runtime environment variable, so bake the cloud identity in.
const clerkIssuer = process.env.GAPPD_CLERK_ISSUER_URL?.trim() || ''
const clerkClientId = process.env.GAPPD_CLERK_CLIENT_ID?.trim() || ''

export default defineConfig([
  {
    entry: {
      'main/main': 'src/main/main.ts',
      'preload/index': 'src/preload/index.ts',
    },
    format: ['cjs'],
    outDir: 'dist-electron',
    target: 'es2022',
    clean: true,
    external: ['electron'],
    noExternal: ['electron-updater'],
    define: { __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleClientId), __GAPPD_GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(googleClientSecret), __GAPPD_SLACK_OAUTH_CLIENT_ID__: JSON.stringify(slackClientId), __GAPPD_CLERK_ISSUER_URL__: JSON.stringify(clerkIssuer), __GAPPD_CLERK_CLIENT_ID__: JSON.stringify(clerkClientId) },
    splitting: false,
    sourcemap: false,
  },
])
