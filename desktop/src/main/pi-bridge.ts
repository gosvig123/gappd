import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { PiConfigurationError, piRuntime, type PiCompletionRequest } from './pi-runtime'

const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 16 * 1024 * 1024
const BRIDGE_PATH = '/complete'

class PiBridge {
  private server: Server | null = null
  private startPromise: Promise<void> | null = null
  private readonly token = randomBytes(32).toString('base64url')
  private port = 0

  async environment(): Promise<NodeJS.ProcessEnv> {
    const status = await piRuntime.status()
    if (!status.selected || !status.configured) throw new PiConfigurationError('Pi setup required before summarization')
    await this.start()
    return { GAPPD_PI_BRIDGE_URL: `http://${HOST}:${this.port}`, GAPPD_PI_BRIDGE_TOKEN: this.token }
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    this.startPromise = null
    this.port = 0
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  private start(): Promise<void> {
    this.startPromise ??= this.listen()
    return this.startPromise
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => { void this.handle(request, response) })
      server.once('error', reject)
      server.listen(0, HOST, () => {
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('Pi bridge did not bind a TCP port'))
        this.server = server
        this.port = address.port
        resolve()
      })
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== BRIDGE_PATH) return writeJSON(response, 404, { error: 'Not found' })
    if (!validBearer(request.headers.authorization, this.token)) return writeJSON(response, 401, { error: 'Unauthorized' })
    const controller = new AbortController()
    const abort = () => controller.abort()
    const close = () => { if (!response.writableEnded) abort() }
    request.once('aborted', abort)
    response.once('close', close)
    try {
      const input = await readRequest(request)
      const result = await piRuntime.complete(input, controller.signal)
      writeJSON(response, 200, result)
    } catch (error) {
      const configuration = error instanceof PiConfigurationError
      writeJSON(response, configuration ? 409 : 500, { code: configuration ? error.code : 'completion_failed', error: errorMessage(error) })
    } finally {
      request.off('aborted', abort)
      response.off('close', close)
    }
  }
}

export const piBridge = new PiBridge()

function validBearer(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice(7))
  const expected = Buffer.from(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function readRequest(request: IncomingMessage): Promise<PiCompletionRequest> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Pi completion request exceeds 16 MiB')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!isCompletionRequest(parsed)) throw new Error('Invalid Pi completion request')
  return parsed
}

function isCompletionRequest(value: unknown): value is PiCompletionRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<PiCompletionRequest>
  return typeof request.system === 'string' && typeof request.user === 'string' && typeof request.temperature === 'number' && typeof request.maxTokens === 'number'
}

function writeJSON(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
