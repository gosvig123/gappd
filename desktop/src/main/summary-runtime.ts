import { requestCommand } from './app-protocol'
import { managedRuntime } from './managed-runtime'
import { piBridge } from './pi-bridge'

const PI_BACKEND = 'pi'

type Work<T> = (env: NodeJS.ProcessEnv) => Promise<T>

export async function usingSummaryRuntime<T>(work: Work<T>): Promise<T> {
  const config = (await requestCommand('config.show', {})).ai
  if (config.provider === PI_BACKEND) return work(await piBridge.environment())
  return managedRuntime.using(['summarization'], () => work({}))
}
