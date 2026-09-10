import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui'

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

/** In-app replacement for `window.confirm`, so destructive actions match the design system. */
export function useConfirm(): ConfirmController {
  const [current, setCurrent] = useState<ConfirmRequest | null>(null)
  const request = useCallback((next: ConfirmRequest) => setCurrent(next), [])
  const close = useCallback(() => setCurrent(null), [])
  return { request, dialog: current ? <ConfirmDialog request={current} onClose={close} /> : null }
}

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEscape(onClose)
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
    <div className="proto-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="proto-dialog" role="dialog" aria-modal="true" aria-label={request.title}>
        <h2>{request.title}</h2>
        <p>{request.body}</p>
        <div className="proto-dialog-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button ref={confirmRef} className={request.tone === 'danger' ? 'proto-dialog-danger' : undefined} variant={request.tone === 'danger' ? 'secondary' : 'primary'} onClick={() => void run()} disabled={busy}>
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

export type UndoController = {
  offer: (message: string, undo: () => void | Promise<void>) => void
  toast: ReactNode
}

/** Undo affordance for actions that are cheap to reverse in the prototype. */
export function useUndo(timeoutMs = 7000): UndoController {
  const [entry, setEntry] = useState<{ id: number; message: string; undo: () => void | Promise<void> } | null>(null)
  useEffect(() => {
    if (!entry) return undefined
    const timer = window.setTimeout(() => setEntry(null), timeoutMs)
    return () => window.clearTimeout(timer)
  }, [entry?.id, timeoutMs])
  const offer = useCallback((message: string, undo: () => void | Promise<void>) => setEntry({ id: Date.now(), message, undo }), [])
  const toast = entry ? (
    <div className="proto-undo" role="status" aria-live="polite">
      <span>{entry.message}</span>
      <button type="button" onClick={() => { void entry.undo(); setEntry(null) }}>Undo</button>
      <button type="button" aria-label="Dismiss" onClick={() => setEntry(null)}>×</button>
    </div>
  ) : null
  return { offer, toast }
}
