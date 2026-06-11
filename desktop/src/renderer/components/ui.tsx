import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'

type PanelProps = HTMLAttributes<HTMLElement> & { children: ReactNode }
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }
type FieldProps = { label: string; children: ReactNode; className?: string; hint?: ReactNode }
type PageHeaderProps = { title: string; description?: ReactNode; action?: ReactNode; className?: string }
type BannerProps = { tone?: 'error' | 'info'; title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }
type ProgressBarProps = { value: number | null; label: string; className?: string }
type ListRowProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function Panel({ className, children, ...props }: PanelProps) {
  return <section className={cx('panel', className)} {...props}>{children}</section>
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ui-card', className)} {...props}>{children}</div>
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return <div className={cx('panel-header', className)}><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action}</div>
}

export function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cx('status-pill', tone)}>{children}</span>
}

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return <button className={cx('ui-button', `ui-button-${variant}`, className)} {...props} />
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

export function Banner({ tone = 'info', title, children, actions, className }: BannerProps) {
  return <div className={cx('banner', tone, className)}>{title ? <strong>{title}</strong> : null}<div>{children}</div>{actions ? <div className="actions-row banner-actions">{actions}</div> : null}</div>
}

export function ListRow({ selected, className, ...props }: ListRowProps) {
  return <button className={cx('list-row', selected && 'selected', className)} aria-pressed={selected} {...props} />
}

export function EmptyState({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('empty-state', className)}>{children}</div>
}
