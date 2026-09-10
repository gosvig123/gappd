import { Button } from '../../components/ui'

/**
 * Inline destructive confirm. Variant B keeps the decision inside the row it
 * belongs to instead of covering the app with a modal: the surrounding list
 * stays readable, and the second click is still explicit.
 */
export function InlineConfirm({ question, detail, confirmLabel, busy, onConfirm, onCancel }: { question: string; detail?: string; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="vb-confirm" role="group" aria-label={question}>
      <div className="vb-confirm-copy">
        <strong>{question}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div className="vb-confirm-actions">
        <Button className="compact-action" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button className="compact-action vb-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
      </div>
    </div>
  )
}
