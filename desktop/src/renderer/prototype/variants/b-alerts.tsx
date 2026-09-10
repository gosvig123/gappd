import { StatusPill } from '../../components/ui'
import type { AlertItem, AlertKind } from '../contract'

type Props = { alerts: AlertItem[]; open: boolean; onToggle: () => void; onDismiss: (id: string) => void }

/**
 * The single alert surface for variant B. Everything that wants attention lands
 * in this one strip: collapsed it is a single line that never pushes the panes
 * down by more than one row, expanded it lists every item with its own action.
 */
export function AlertBar({ alerts, open, onToggle, onDismiss }: Props) {
  if (!alerts.length) return null
  const lead = alerts.find((alert) => alert.kind === 'blocking') ?? alerts[0]
  if (!lead) return null
  const extra = alerts.length - 1
  return (
    <section className={open ? 'vb-alerts is-open' : 'vb-alerts'} aria-label="Status">
      <div className="vb-alerts-line">
        <StatusPill tone={toneOf(lead.kind)}>{labelOf(lead.kind)}</StatusPill>
        <strong>{lead.title}</strong>
        {open || !lead.detail ? null : <span className="vb-alerts-detail">{lead.detail}</span>}
        <span className="vb-alerts-spacer" />
        {extra > 0 ? <button type="button" className="vb-alerts-toggle" aria-expanded={open} onClick={onToggle}>{open ? 'Hide' : `+${extra} more`}</button> : null}
        {extra === 0 && lead.actionLabel && lead.run ? <button type="button" className="vb-alerts-action" onClick={lead.run}>{lead.actionLabel}</button> : null}
      </div>
      {open ? <AlertList alerts={alerts} onDismiss={onDismiss} /> : null}
    </section>
  )
}

function AlertList({ alerts, onDismiss }: { alerts: AlertItem[]; onDismiss: (id: string) => void }) {
  return (
    <ul className="vb-alerts-list">
      {alerts.map((alert) => (
        <li key={alert.id} className={`vb-alert ${alert.kind}`}>
          <div className="vb-alert-copy">
            <strong>{alert.title}</strong>
            {alert.detail ? <p>{alert.detail}</p> : null}
          </div>
          <div className="vb-alert-actions">
            {alert.actionLabel && alert.run ? <button type="button" className="vb-alerts-action" onClick={alert.run}>{alert.actionLabel}</button> : null}
            {alert.kind === 'blocking' ? null : <button type="button" className="vb-alert-dismiss" aria-label={`Dismiss ${alert.title}`} onClick={() => onDismiss(alert.id)}>×</button>}
          </div>
        </li>
      ))}
    </ul>
  )
}

function toneOf(kind: AlertKind): 'failed' | 'stopping' | 'idle' {
  if (kind === 'blocking') return 'failed'
  return kind === 'attention' ? 'stopping' : 'idle'
}

function labelOf(kind: AlertKind): string {
  if (kind === 'blocking') return 'Action needed'
  return kind === 'attention' ? 'Attention' : 'Notice'
}
