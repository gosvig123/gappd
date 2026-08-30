import { defineConfig } from 'tsup'

const serviceConfigDefines = {
  __GAPPD_CLERK_ISSUER__: JSON.stringify(process.env.GAPPD_CLERK_ISSUER || ''),
  __GAPPD_CLERK_OAUTH_CLIENT_ID__: JSON.stringify(process.env.GAPPD_CLERK_OAUTH_CLIENT_ID || ''),
  __GAPPD_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(process.env.GAPPD_GOOGLE_OAUTH_CLIENT_ID || ''),
}

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
    define: serviceConfigDefines,
    splitting: false,
    sourcemap: false,
  },
])
