import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/hanken-grotesk/600.css'
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/400-italic.css'
import '@fontsource/jetbrains-mono/400.css'
import '../theme.css'
import '../styles.css'
import '../components/ui.css'
import './prototype.css'
import { PrototypeApp } from './host'
import { installStubApi } from './stub/api'

/*
 * PROTOTYPE ENTRY. Not part of the app bundle: `vite build` only builds
 * index.html, so nothing here can reach a release.
 *
 * The stub installs a seeded, in-memory `window.gappd` so the variants run
 * without the Electron bridge and without touching the Meeting database.
 */
installStubApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrototypeApp />
  </React.StrictMode>,
)
