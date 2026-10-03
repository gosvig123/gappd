import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  // Electron loads this exact port, so never fall back to another one: a busy port would
  // otherwise load whatever other dev server owns it into the Gappd window.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.GAPPD_UI_VITE_PORT || 5173),
    strictPort: true,
  },
})
