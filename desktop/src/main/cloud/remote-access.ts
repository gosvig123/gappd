import type { RemoteAccessState, RemoteAccessStatus, RemoteAIServiceId } from '../../shared/remote-access'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { remoteAIServiceForClient } from '../../shared/remote-access.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { AccessTokenVerifier, tokenClientId } from './access-token.ts'
// @ts-ignore Node type stripping requires explicit TypeScript extension.
import { LocalMcp, rpcError, type LocalMcpCommand } from './local-mcp.ts'

// Remote access keeps one WebSocket open to Gappd Cloud's /relay while Gappd runs. The cloud
// sends each /mcp request through it with the caller's token; this Mac checks the token and
// answers from `gappd mcp --remote`, which has the Meeting tools and no SQL.

const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 5 * 60_000
const SIGNED_OUT_RETRY_MS = 60_000
// The cloud ends each connection after an hour; a planned end reconnects at once.
const RECONNECT_MS = 1_000
// The cloud reads at most 4 MB per answer and closes the connection on a larger one.
const MAX_ANSWER_BYTES = (4 << 20) - 4096
// Close codes the cloud sends: the planned end of a connection, and a newer connection that replaced it.
const PLANNED_END = 1000
const REPLACED = 1008
// A service's last use is saved at most this often; the panel shows it in minutes at best.
const LAST_USED_SAVE_MS = 5 * 60_000

export type LastUsed = Partial<Record<RemoteAIServiceId, string>>

/** What remote access needs from the app: the account, the cloud addresses, the setting and Gappd. */
export type RemoteAccessDependencies = {
  credential(): Promise<{ subject: string; accessToken: string } | null>
  observeAuthorization(listener: () => void): () => void
  issuer(): string
  resource(): string
  readEnabled(): boolean
  writeEnabled(enabled: boolean): void
  readLastUsed(): LastUsed
  writeLastUsed(lastUsed: LastUsed): void
  command(): LocalMcpCommand
  now?: () => number
}

type Frame = { id: number; token: string; body: { id?: unknown; jsonrpc?: unknown; method?: unknown } }

export class RemoteAccess {
  private unobserve: (() => void) | null = null
  private state: RemoteAccessState = 'off'
  private socket: WebSocket | null = null
  private timer: NodeJS.Timeout | null = null
  private retryMs = RETRY_MIN_MS
  private generation = 0
  private readonly verifier = new AccessTokenVerifier()
  private readonly mcp: LocalMcp
  private readonly app: RemoteAccessDependencies
  private lastUsed: LastUsed | null = null

  constructor(app: RemoteAccessDependencies) {
    this.app = app
    this.mcp = new LocalMcp(() => app.command())
  }

  status(): RemoteAccessStatus {
    return { enabled: this.app.readEnabled(), state: this.state, address: this.app.resource(), lastUsed: { ...this.readLastUsed() } }
  }

  private readLastUsed(): LastUsed {
    this.lastUsed ||= this.app.readLastUsed()
    return this.lastUsed
  }

  /** Notes that a known AI service sent a request with a valid Meeting read token, so the panel can show that its setup worked. */
  private noteUse(token: string): void {
    const clientId = tokenClientId(token)
    const service = clientId ? remoteAIServiceForClient(clientId) : null
    if (!service) return
    const now = (this.app.now ?? Date.now)()
    const lastUsed = this.readLastUsed()
    const previous = Date.parse(lastUsed[service] ?? '')
    if (Number.isFinite(previous) && now >= previous && now - previous < LAST_USED_SAVE_MS) return
    lastUsed[service] = new Date(now).toISOString()
    try {
      this.app.writeLastUsed({ ...lastUsed })
    } catch {
      // The status still shows the use until Gappd quits; a failed save only loses it after that.
    }
  }

  start(): void {
    this.observeAuthorization()
    if (this.app.readEnabled() && this.state === 'off') this.reconnect()
  }

  stop(): void {
    this.unobserve?.()
    this.unobserve = null
    this.generation++
    this.clearTimer()
    this.closeSocket()
    this.mcp.close()
    this.state = 'off'
  }

  setEnabled(enabled: boolean): RemoteAccessStatus {
    this.app.writeEnabled(enabled)
    this.stop()
    if (enabled) this.reconnect()
    return this.status()
  }

  /** Opens a new connection now, for example after the Mac wakes and the old one went silent. */
  reconnect(): void {
    if (!this.app.readEnabled() || this.state === 'replaced') return
    this.observeAuthorization()
    this.generation++
    this.clearTimer()
    this.closeSocket()
    this.mcp.close()
    this.retryMs = RETRY_MIN_MS
    void this.connect(this.generation)
  }

  private observeAuthorization(): void {
    this.unobserve ||= this.app.observeAuthorization(() => this.reconnect())
  }

  private async connect(generation: number): Promise<void> {
    this.state = 'connecting'
    const credential = await this.app.credential().catch(() => null)
    if (generation !== this.generation) return
    if (!credential) {
      this.state = 'signed-out'
      this.retry(generation, SIGNED_OUT_RETRY_MS)
      return
    }
    const url = new URL('/relay', this.app.resource())
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
    // Node's WebSocket also takes request headers; the browser type in this build does not list them.
    const init = { headers: { Authorization: `Bearer ${credential.accessToken}` } }
    const socket = new WebSocket(url, init as unknown as string[])
    const subject = credential.subject
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket || generation !== this.generation) return
      this.state = 'connected'
      this.retryMs = RETRY_MIN_MS
    }
    socket.onmessage = (event) => { void this.answer(socket, generation, subject, event.data) }
    socket.onerror = () => undefined
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      if (event.code === REPLACED) {
        this.state = 'replaced'
        this.mcp.close()
        try {
          this.app.writeEnabled(false)
        } catch {
          // The state already stops this Mac; the saved setting is fixed when the user turns remote access on or off.
        }
        return
      }
      const planned = event.code === PLANNED_END
      this.state = planned ? 'connecting' : 'offline'
      this.retry(generation, planned ? RECONNECT_MS : this.retryMs)
      if (!planned) this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS)
    }
  }

  private async answer(socket: WebSocket, generation: number, subject: string, data: unknown): Promise<void> {
    const frame = parseFrame(data)
    if (!frame || this.socket !== socket || generation !== this.generation) return
    if (frame.body.jsonrpc !== '2.0' || typeof frame.body.method !== 'string') {
      return send(socket, frame.id, JSON.parse(rpcError(frame.body.id ?? null, -32600, 'Invalid request')))
    }
    // A notification needs no answer, and Gappd sends none.
    if (!('id' in frame.body)) return send(socket, frame.id, null)
    const id = frame.body.id
    const allowed = await this.verifier.verify(frame.token, { issuer: this.app.issuer(), resource: this.app.resource(), subject })
    if (this.socket !== socket || generation !== this.generation) return
    if (allowed) this.noteUse(frame.token)
    let answer = allowed
      ? await this.mcp.call(JSON.stringify(frame.body), id)
      : rpcError(id, -32001, 'This token cannot read Meetings on this Mac. Reconnect Gappd in your AI service.')
    if (this.socket !== socket || generation !== this.generation) return
    if (Buffer.byteLength(answer) > MAX_ANSWER_BYTES) answer = rpcError(id, -32002, 'This answer is too large for remote access. Ask for fewer Meetings or a shorter part.')
    let body: unknown
    try {
      body = JSON.parse(answer)
    } catch {
      body = JSON.parse(rpcError(id, -32003, 'Gappd on the Mac gave an answer that is not valid. Try again.'))
    }
    send(socket, frame.id, body)
  }

  private retry(generation: number, delayMs: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => { if (generation === this.generation) void this.connect(generation) }, delayMs)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    socket?.close()
  }
}

function send(socket: WebSocket, id: number, body: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, body }))
}

function parseFrame(data: unknown): Frame | null {
  if (typeof data !== 'string') return null
  try {
    const frame = JSON.parse(data) as Partial<Frame>
    const valid = Number.isSafeInteger(frame.id) && typeof frame.token === 'string' &&
      Boolean(frame.body) && typeof frame.body === 'object' && !Array.isArray(frame.body)
    return valid ? frame as Frame : null
  } catch {
    return null
  }
}
