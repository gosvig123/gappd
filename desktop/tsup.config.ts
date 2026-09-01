import { defineConfig } from 'tsup'

const googleClientId = process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID?.trim() || ''

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
    define: { __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleClientId) },
    splitting: false,
    sourcemap: false,
  },
])
