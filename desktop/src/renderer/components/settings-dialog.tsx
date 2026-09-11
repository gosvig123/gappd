import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { SettingsView } from '../routes/settings-view'
import type { AppView } from '../lib/app-view'
import type { ThemeName } from '../hooks/use-theme'
import { useFocusTrap } from '../hooks/use-focus-trap'
import './settings-dialog.css'

export function SettingsDialog({ view, onClose }: { view: AppView; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useFocusTrap(modalRef)
  return (
    <div className="app-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={modalRef} className="app-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="app-modal-head">
          <h2>Settings</h2>
          <button type="button" className="app-icon-action" aria-label="Close settings" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="app-modal-body ui-scroll">
          <SettingsView
            language={view.language}
            onLanguageChange={view.actions.setLanguage}
            theme={view.theme}
            onThemeChange={view.actions.setTheme as (theme: ThemeName) => void}
            localAI={{ status: view.runtime, loading: view.runtimeLoading, busy: view.runtimeBusy, onRepair: view.actions.repairRuntime }}
            calendar={view.calendarController}
            developerDebugEnabled={import.meta.env.DEV}
          />
        </div>
      </div>
    </div>
  )
}

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}
