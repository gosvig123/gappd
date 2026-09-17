import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime'
const CODEX_BACKEND = 'codex_exec'

type Work<T> = (env: NodeJS.ProcessEnv) => Promise<T>

export async function usingSummaryRuntime<T>(work: Work<T>, requireReady = false): Promise<T> {
  const config = (await requestCommand('config.show', {})).ai
  if (config.provider === CODEX_BACKEND) return work({})
  if (requireReady) assertLocalRuntimeReady()
  return managedRuntime.using(['summarization'], () => work({}))
}

function assertLocalRuntimeReady(): void {
  const runtime = managedRuntime.status()
  if (runtime.activity !== 'idle' || runtime.operation !== 'ready') {
    throw new Error('Local AI is busy or unavailable. Try again when it is ready. Recording continues.')
  }
}
