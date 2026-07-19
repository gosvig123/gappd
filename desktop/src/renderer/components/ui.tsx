import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, useState } from 'react'
import { ChevronDownIcon } from './icons'

type PanelProps = HTMLAttributes<HTMLElement> & { children: ReactNode }
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }
type FieldProps = { label: string; children: ReactNode; className?: string; hint?: ReactNode }
type PageHeaderProps = { title: string; description?: ReactNode; action?: ReactNode; middle?: ReactNode; className?: string }
type BannerProps = { tone?: 'error' | 'info'; title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; dismissible?: boolean; dismissKey?: string; dismissLabel?: string }
type ProgressBarProps = { value: number | null; label: string; className?: string }
type ListRowProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }
type MultiSelectProps = { ariaLabel: string; allLabel: string; options: Array<{ value: string; label: ReactNode }>; selected: string[]; onChange: (values: string[]) => void }

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function Panel({ className, children, ...props }: PanelProps) {
  return <section className={cx('panel', className)} {...props}>{children}</section>
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ui-card', className)} {...props}>{children}</div>
}

export function PageHeader({ title, description, action, middle, className }: PageHeaderProps) {
  return <div className={cx('panel-header', className)}><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{middle}{action}</div>
}

export function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cx('status-pill', tone)}>{children}</span>
}

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return <button className={cx('ui-button', `ui-button-${variant}`, className)} {...props} />
}

export function MultiSelect({ ariaLabel, allLabel, options, selected, onChange }: MultiSelectProps) {
  const values = new Set(selected)
  const count = options.filter((option) => values.has(option.value)).length
  const all = count === options.length
  const toggle = (value: string, target: HTMLInputElement) => {
    const next = options.filter((option) => values.has(option.value) !== (option.value === value)).map((option) => option.value)
    onChange(next); if (next.length === 0) target.closest('details')?.removeAttribute('open')
  }
  return (
    <details className="ui-multi-select" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open') }} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.removeAttribute('open') }}>
      <summary className="ui-button ui-button-secondary compact-action ui-multi-select-trigger" aria-label={ariaLabel}><span>{all ? allLabel : count ? `${count} selected` : 'None selected'}</span><ChevronDownIcon aria-hidden="true" /></summary>
      <div className="ui-card ui-multi-select-menu" role="group" aria-label={ariaLabel}>
        <label className="list-row ui-multi-select-option all"><input type="checkbox" checked={all} onChange={(event) => { onChange(event.target.checked ? options.map((option) => option.value) : []); if (!event.target.checked) event.currentTarget.closest('details')?.removeAttribute('open') }} /><span>{allLabel}</span></label>
        {options.map((option) => <label key={option.value} className="list-row ui-multi-select-option"><input type="checkbox" checked={values.has(option.value)} onChange={(event) => toggle(option.value, event.currentTarget)} /><span>{option.label}</span></label>)}
      </div>
    </details>
  )
}

export function Field({ label, children, className, hint }: FieldProps) {
  return <label className={cx('field', className)}><span>{label}</span>{children}{hint ? <span className="field-hint">{hint}</span> : null}</label>
}

export function MetricCard({ label, value }: { label: string; value: ReactNode }) {
  return <div className="metric-card"><div className="label">{label}</div><div className="value">{value}</div></div>
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  if (value === null) return <div className={cx('progress-track indeterminate', className)} aria-label={label}><div className="progress-fill indeterminate" /></div>
  return <progress className={cx('progress-track', className)} value={value} max={100} aria-label={label}>{value}%</progress>
}

export function Banner({ tone = 'info', title, children, actions, className, dismissible, dismissKey, dismissLabel = 'Dismiss message' }: BannerProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const key = dismissKey ?? fallbackDismissKey(title, children)
  if (dismissible && dismissedKey === key) return null
  return <div className={cx('banner', tone, className)}>{title || dismissible ? <div className="banner-head">{title ? <strong>{title}</strong> : <span />}{dismissible ? <button className="icon-dismiss" type="button" aria-label={dismissLabel} onClick={() => setDismissedKey(key)}>×</button> : null}</div> : null}<div>{children}</div>{actions ? <div className="actions-row banner-actions">{actions}</div> : null}</div>
}

function fallbackDismissKey(title: ReactNode, children: ReactNode): string {
  return `${typeof title === 'string' ? title : ''}:${typeof children === 'string' ? children : ''}`
}

export function ListRow({ selected, className, ...props }: ListRowProps) {
  return <button className={cx('list-row', selected && 'selected', className)} aria-pressed={selected} {...props} />
}

export function EmptyState({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('empty-state', className)}>{children}</div>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('skeleton-line', i === lines - 1 ? 'short' : 'long')} />
      ))}
    </div>
  )
}
