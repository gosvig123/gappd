import { defineConfig } from 'tsup'

const googleClientId = process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID?.trim() || ''
const slackClientId = process.env.GAPPD_SLACK_OAUTH_CLIENT_ID?.trim() || ''
// Packaged builds cannot rely on a runtime environment variable, so bake the capability in.
const clerkIssuer = process.env.GAPPD_CLERK_ISSUER_URL?.trim() || ''
const clerkClientId = process.env.GAPPD_CLERK_CLIENT_ID?.trim() || ''
const meetingUploadEnabled = process.env.GAPPD_MEETING_UPLOAD_ENABLED === 'true' ? 'true' : ''

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
    define: { __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleClientId), __GAPPD_SLACK_OAUTH_CLIENT_ID__: JSON.stringify(slackClientId), __GAPPD_MEETING_UPLOAD_ENABLED__: JSON.stringify(meetingUploadEnabled), __GAPPD_CLERK_ISSUER_URL__: JSON.stringify(clerkIssuer), __GAPPD_CLERK_CLIENT_ID__: JSON.stringify(clerkClientId) },
    splitting: false,
    sourcemap: false,
  },
])
