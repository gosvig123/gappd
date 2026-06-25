import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app'
import { installTransientScrollbars } from './scrollbars'
import './theme.css'
import './styles.css'
import './components/ui.css'
import './shell.css'

installTransientScrollbars()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
