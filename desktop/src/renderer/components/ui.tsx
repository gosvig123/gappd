import { type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, useId, useRef, useState } from 'react'
import { ChevronDownIcon } from './icons'

type PanelProps = HTMLAttributes<HTMLElement> & { children: ReactNode }
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; ref?: Ref<HTMLButtonElement> }
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
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const groupId = useId()
  const values = new Set(selected)
  const count = options.filter((option) => values.has(option.value)).length
  const all = count === options.length
  const apply = (next: string[]) => {
    onChange(next)
    if (next.length === 0) {
      setOpen(false)
      triggerRef.current?.focus()
    }
  }
  const toggle = (value: string) => apply(options.filter((option) => values.has(option.value) !== (option.value === value)).map((option) => option.value))
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    triggerRef.current?.focus()
  }
  return (
    <div className={cx('ui-multi-select', open && 'open')} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={handleEscape}>
      <Button ref={triggerRef} type="button" className="compact-action ui-multi-select-trigger" aria-label={ariaLabel} aria-controls={groupId} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>{all ? allLabel : count ? `${count} selected` : 'None selected'}</span><ChevronDownIcon aria-hidden="true" /></Button>
      {open ? <div id={groupId} className="ui-card ui-multi-select-menu" role="group" aria-label={ariaLabel}>
        <button type="button" className="list-row ui-multi-select-option all" role="checkbox" aria-checked={all} onClick={() => apply(all ? [] : options.map((option) => option.value))}><span>{allLabel}</span></button>
        {options.map((option) => <button type="button" key={option.value} className="list-row ui-multi-select-option" role="checkbox" aria-checked={values.has(option.value)} onClick={() => toggle(option.value)}><span>{option.label}</span></button>)}
      </div> : null}
    </div>
  )
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
