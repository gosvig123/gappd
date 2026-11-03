import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

// Gappd answers within this time, or the child is stopped. The cloud waits 8 seconds in total.
const REPLY_TIMEOUT_MS = 7_000

export type LocalMcpCommand = { command: string; args: string[]; env: NodeJS.ProcessEnv }

/**
 * One `gappd mcp --remote` child that answers one JSON-RPC request at a time. Each request with an
 * id gets exactly one line back, so requests wait in a queue instead of matching ids.
 */
export class LocalMcp {
  private child: ChildProcessWithoutNullStreams | null = null
  private waiting: ((line: string | null) => void) | null = null
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()
  private readonly command: () => LocalMcpCommand

  constructor(command: () => LocalMcpCommand) {
    this.command = command
  }

  /** Answers one request that has an id. A failure becomes a JSON-RPC error for that id. */
  call(request: string, id: unknown): Promise<string> {
    const generation = this.generation
    const answer = this.queue.then(() => generation === this.generation
      ? this.send(request, id)
      : rpcError(id, -32003, 'Remote access stopped before Gappd answered. Try again.'))
    this.queue = answer.catch(() => undefined)
    return answer
  }

  close(): void {
    this.generation++
    const child = this.child
    this.child = null
    this.waiting?.(null)
    child?.kill()
  }

  private send(request: string, id: unknown): Promise<string> {
    return new Promise((resolve) => {
      const finish = (line: string | null, message: string) => {
        clearTimeout(timer)
        if (this.waiting !== waiting) return
        this.waiting = null
        resolve(line ?? rpcError(id, -32003, message))
      }
      const timer = setTimeout(() => {
        this.child?.kill()
        this.child = null
        finish(null, 'Gappd on the Mac took too long to answer. Try again.')
      }, REPLY_TIMEOUT_MS)
      const waiting = (line: string | null) => finish(line, 'Gappd on the Mac stopped before it answered. Try again.')
      this.waiting = waiting
      try {
        this.start().stdin.write(`${request}\n`)
      } catch {
        finish(null, 'Gappd on the Mac could not start. Check that Gappd is installed correctly.')
      }
    })
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const { command, args, env } = this.command()
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    const stopped = () => {
      if (this.child !== child) return
      this.child = null
      this.waiting?.(null)
    }
    readline.createInterface({ input: child.stdout }).on('line', (line) => { if (this.child === child) this.waiting?.(line) })
    child.stderr.resume()
    child.stdin.on('error', stopped)
    child.on('error', stopped)
    child.on('exit', stopped)
    this.child = child
    return child
  }
}

export function rpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}
