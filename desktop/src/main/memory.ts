const MEMORY_DEBUG_ENV = 'GAPPD_DEBUG_MEMORY'

export function logMainProcessMemory(label: string): void {
  if (process.env[MEMORY_DEBUG_ENV] !== '1') return
  const usage = process.memoryUsage()
  console.info(`[memory] ${label} rss=${mb(usage.rss)} heapUsed=${mb(usage.heapUsed)} heapTotal=${mb(usage.heapTotal)} external=${mb(usage.external)} arrayBuffers=${mb(usage.arrayBuffers)}`)
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}
