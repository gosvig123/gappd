import { useEffect } from 'react'
import { CloseIcon } from '../../components/icons'
import { SettingsView } from '../../routes/settings-view'
import type { PrototypeView } from '../contract'

/** Variant B puts settings in a centred modal, so the console stays visible behind it. */
export function SettingsModal({ view, onClose }: { view: PrototypeView; onClose: () => void }) {
  useEscape(onClose)
  return (
    <div className="vb-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="vb-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="vb-modal-head">
          <h2>Settings</h2>
          <button type="button" className="vb-modal-close" aria-label="Close settings" onClick={onClose}><CloseIcon aria-hidden="true" /></button>
        </div>
        <div className="vb-modal-body proto-scroll">
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
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose])
}
