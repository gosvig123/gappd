import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime'
const CODEX_BACKEND = 'codex_exec'

type Work<T> = (env: NodeJS.ProcessEnv) => Promise<T>

export async function usingSummaryRuntime<T>(work: Work<T>): Promise<T> {
  const config = (await requestCommand('config.show', {})).ai
  if (config.provider === CODEX_BACKEND) return work({})
  return managedRuntime.using(['summarization'], () => work({}))
}
