import { stackFrames, type RendererError } from '../shared/error-report'

/** Send the window's uncaught errors to the main process, which reports them when error reports are on. */
export function installErrorReports(): void {
  window.addEventListener('error', (event) => send('renderer.error', event.error))
  window.addEventListener('unhandledrejection', (event) => send('renderer.unhandled-rejection', event.reason))
}

function send(operation: RendererError['operation'], error: unknown): void {
  if (error === null || error === undefined) return
  const fields = typeof error === 'object' ? error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown } : {}
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  void window.gappd.errorReports.report({ operation, name: text(fields.name), code: text(fields.code), stack: stackFrames(fields.stack, fields.message) })
    .catch(() => undefined)
}
