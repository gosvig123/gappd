export type ProviderChangeToken = { generation: number }

export type ProviderChangeGate = {
  generation(): number
  current(generation: number): boolean
  changing(): boolean
  runSave(generation: number, save: () => Promise<unknown>): Promise<boolean>
  beginChange(): Promise<ProviderChangeToken>
  endChange(token: ProviderChangeToken): void
}

class ProviderChangeGateState implements ProviderChangeGate {
  private value = 0
  private active = false
  private readonly saves = new Set<Promise<unknown>>()
  private readonly waiters: Array<() => void> = []

  generation(): number { return this.value }
  current(candidate: number): boolean { return candidate === this.value }
  changing(): boolean { return this.active }

  async beginChange(): Promise<ProviderChangeToken> {
    if (this.active) await new Promise<void>((resolve) => this.waiters.push(resolve))
    else this.active = true
    this.value += 1
    const token = { generation: this.value }
    await Promise.allSettled([...this.saves])
    return token
  }

  endChange(token: ProviderChangeToken): void {
    if (!this.active || token.generation !== this.value) throw new Error('Provider change token is stale')
    const next = this.waiters.shift()
    if (next) next()
    else this.active = false
  }

  async runSave(candidate: number, save: () => Promise<unknown>): Promise<boolean> {
    if (this.active || candidate !== this.value) return false
    const pending = save()
    this.saves.add(pending)
    try { await pending; return true }
    finally { this.saves.delete(pending) }
  }
}

export function createProviderChangeGate(): ProviderChangeGate {
  return new ProviderChangeGateState()
}
