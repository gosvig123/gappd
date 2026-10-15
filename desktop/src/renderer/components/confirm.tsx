import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './ui'
import { useFocusTrap } from '../hooks/use-focus-trap'
import './confirm.css'

export type ConfirmRequest = {
  title: string
  body: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'default'
  onConfirm: () => void | Promise<void>
}

export type ConfirmController = {
  request: (request: ConfirmRequest) => void
  dialog: ReactNode
}

/** In-app replacement for `window.confirm`, so destructive actions match the app. */
export function useConfirm(): ConfirmController {
  const [current, setCurrent] = useState<ConfirmRequest | null>(null)
  const request = useCallback((next: ConfirmRequest) => setCurrent(next), [])
  const close = useCallback(() => setCurrent(null), [])
  return { request, dialog: current ? <ConfirmDialog request={current} onClose={close} /> : null }
}

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEscape(onClose)
  useFocusTrap(dialogRef)
  useEffect(() => { confirmRef.current?.focus() }, [])
  const run = async () => {
    setBusy(true)
    try {
      await request.onConfirm()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ui-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="ui-dialog" role="dialog" aria-modal="true" aria-label={request.title}>
        <h2>{request.title}</h2>
        <p>{request.body}</p>
        <div className="ui-dialog-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button ref={confirmRef} className={request.tone === 'danger' ? 'ui-dialog-danger' : undefined} variant={request.tone === 'danger' ? 'secondary' : 'primary'} onClick={() => void run()} disabled={busy}>
            {busy ? 'Working…' : request.confirmLabel}
          </Button>
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
