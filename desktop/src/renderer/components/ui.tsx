import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'

type PanelProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function Panel({ className, children, ...props }: PanelProps) {
  return <section className={cx('panel', className)} {...props}>{children}</section>
}

export function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cx('status-pill', tone)}>{children}</span>
}

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return <button className={cx('ui-button', `ui-button-${variant}`, className)} {...props} />
}

export function EmptyState({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('empty-state', className)}>{children}</div>
}
