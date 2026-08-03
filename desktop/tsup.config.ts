import path from 'node:path'
import { defineConfig } from 'tsup'

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
    noExternal: ['electron-updater', '@earendil-works/pi-coding-agent'],
    esbuildOptions(options) {
      options.alias = { ...options.alias, 'brace-expansion': path.resolve('node_modules/brace-expansion/dist/esm/index.js') }
    },
    splitting: false,
    sourcemap: false,
  },
])
