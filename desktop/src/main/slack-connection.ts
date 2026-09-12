// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { authorizeSlack, refreshSlackTokens, SlackReconnectError, SLACK_REFRESH_SKEW_MS, type SlackOAuthDependencies, type SlackTokenSet } from './slack-oauth.ts'

export type SlackConnectionStore = {
  read(): Promise<SlackTokenSet | null>
  write(value: SlackTokenSet): Promise<void>
  clear(): Promise<void>
}

/**
 * Owns the Slack user token for this Mac. Rotating refresh tokens are single
 * use, so refreshes are serialized and the new token set is written to the
 * encrypted store before any caller receives the access token.
 *
 * Every operation belongs to a lifecycle generation that changes on
 * disconnect. Store mutations run in one queue, and a mutation from an older
 * generation is dropped, so a pending connect or refresh can never restore
 * tokens after a disconnect or clear the tokens of a newer connection.
 */
export class SlackConnection {
  private readonly clientId: string
  private readonly store: SlackConnectionStore
  private readonly dependencies: SlackOAuthDependencies
  private refresh: Promise<SlackTokenSet> | null = null
  private generation = 0
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(clientId: string, store: SlackConnectionStore, dependencies: SlackOAuthDependencies) {
    this.clientId = clientId
    this.store = store
    this.dependencies = dependencies
  }

  async connect(): Promise<SlackTokenSet> {
    const generation = this.generation
    const tokens = await authorizeSlack(this.clientId, this.dependencies)
    this.requireCurrent(generation, 'connect')
    await this.writeTokens(generation, tokens)
    this.requireCurrent(generation, 'connect')
    return tokens
  }

  tokens(): Promise<SlackTokenSet | null> {
    return this.serialize(() => this.store.read())
  }

  async accessToken(): Promise<string> {
    const generation = this.generation
    const tokens = await this.tokens()
    this.requireCurrent(generation, 'refresh')
    if (!tokens) throw new Error('Slack is not connected.')
    if (tokens.expiresAt > this.now() + SLACK_REFRESH_SKEW_MS) return tokens.accessToken
    return (await this.rotate(tokens.refreshToken)).accessToken
  }

  async disconnect(): Promise<void> {
    this.generation += 1
    this.refresh = null
    await this.serialize(() => this.store.clear())
  }

  private rotate(refreshToken: string): Promise<SlackTokenSet> {
    if (!this.refresh) {
      const rotation = this.rotateTokens(refreshToken).finally(() => {
        if (this.refresh === rotation) this.refresh = null
      })
      this.refresh = rotation
    }
    return this.refresh
  }

  private async rotateTokens(refreshToken: string): Promise<SlackTokenSet> {
    const generation = this.generation
    try {
      const tokens = await refreshSlackTokens(this.clientId, refreshToken, this.dependencies)
      this.requireCurrent(generation, 'refresh')
      await this.writeTokens(generation, tokens)
      this.requireCurrent(generation, 'refresh')
      return tokens
    } catch (error) {
      if (error instanceof SlackReconnectError) await this.clearTokens(generation)
      throw error
    }
  }

  private writeTokens(generation: number, tokens: SlackTokenSet): Promise<void> {
    return this.serialize(async () => {
      if (generation !== this.generation) return
      await this.store.write(tokens)
    })
  }

  private clearTokens(generation: number): Promise<void> {
    return this.serialize(async () => {
      if (generation !== this.generation) return
      await this.store.clear()
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation)
    this.mutations = result.catch(() => undefined)
    return result
  }

  private requireCurrent(generation: number, operation: 'connect' | 'refresh'): void {
    if (generation !== this.generation) throw new Error(`Slack was disconnected during ${operation}.`)
  }

  private now(): number {
    return (this.dependencies.now || Date.now)()
  }
}
