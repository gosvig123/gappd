import { useEffect } from 'react'
import { X } from 'lucide-react'
import { SettingsView } from '../../routes/settings-view'
import type { PrototypeView } from '../contract'

export function DeckSettings({ view, onClose }: { view: PrototypeView; onClose: () => void }) {
  useEscape(onClose)
  return (
    <div className="vc-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="vc-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="vc-modal-head">
          <h2>Settings</h2>
          <button type="button" className="vc-icon-action" aria-label="Close settings" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="vc-modal-body proto-scroll">
          <SettingsView
            language={view.language}
            onLanguageChange={view.actions.setLanguage}
            localAI={{ status: view.runtime, loading: view.runtimeLoading, busy: view.runtimeBusy, onRepair: () => view.actions.repairRuntime('repair') }}
            calendar={view.calendarController}
            developerDebugEnabled={false}
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
