// Logs a failure and hands it to the Error report sender. It has no Electron import, so modules
// that the Node tests load can use it; error-report.ts installs the sender at startup.

type FailureSink = (operation: string, error: unknown) => void

let sink: FailureSink | null = null

export function setFailureSink(next: FailureSink | null): void {
  sink = next
}

/** operation is a fixed name such as calendar.refresh; message is for the local log only. */
export function logFailure(operation: string, message: string, error?: unknown): void {
  if (error === undefined) console.error(message)
  else console.error(message, error)
  reportFailure(operation, error)
}

/** Report without a log line, for a failure that is already shown or logged. */
export function reportFailure(operation: string, error: unknown): void {
  try {
    sink?.(operation, error)
  } catch {
    // A report must never turn into a second failure.
  }
}
