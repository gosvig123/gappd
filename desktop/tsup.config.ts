import path from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { main: 'src/main/main.ts' },
    format: ['cjs'],
    outDir: 'dist-electron/main',
    target: 'es2022',
    clean: true,
    external: ['electron'],
    noExternal: ['electron-updater', '@earendil-works/pi-coding-agent'],
    esbuildOptions(options) {
      options.alias = { ...options.alias, 'brace-expansion': path.resolve('node_modules/brace-expansion/dist/esm/index.js') }
      options.define = { ...options.define, 'import.meta.url': '__gappdImportMetaUrl' }
      options.banner = { ...options.banner, js: 'const __gappdImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' }
    },
    splitting: false,
    sourcemap: false,
  },
  {
    entry: { index: 'src/preload/index.ts' },
    format: ['cjs'],
    outDir: 'dist-electron/preload',
    target: 'es2022',
    clean: true,
    external: ['electron'],
    splitting: false,
    sourcemap: false,
  },
])
