import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app'
import { installTransientScrollbars } from './scrollbars'
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './theme.css'
import './styles.css'
import './components/ui.css'

const MergedPrototype = import.meta.env.DEV && new URLSearchParams(location.search).has('variant')
  ? React.lazy(() => import('./sections/meetings-calendar-prototype').then(module => ({ default: module.MeetingsCalendarPrototype })))
  : null

installTransientScrollbars()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {MergedPrototype ? <React.Suspense fallback={null}><MergedPrototype /></React.Suspense> : <App />}
  </React.StrictMode>,
)
