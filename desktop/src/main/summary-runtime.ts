import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime/runtime'
const LOCAL_BACKEND = 'llamacpp'

type Work<T> = (env: NodeJS.ProcessEnv) => Promise<T>

export async function usingSummaryRuntime<T>(work: Work<T>, requireReady = false): Promise<T> {
  const config = (await requestCommand('config.show', {})).ai
  // Agent providers run their own CLI, outside the managed Local AI runtime.
  if (config.provider !== LOCAL_BACKEND) return work({})
  if (requireReady) assertLocalRuntimeReady()
  return managedRuntime.using(['summarization'], () => work({}))
}

function assertLocalRuntimeReady(): void {
  const runtime = managedRuntime.status()
  if (runtime.activity !== 'idle' || runtime.operation !== 'ready') {
    throw new Error('Local AI is busy or unavailable. Try again when it is ready. Recording continues.')
  }
}
