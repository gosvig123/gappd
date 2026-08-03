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
    splitting: false,
    sourcemap: false,
  },
])
