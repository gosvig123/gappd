import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'

type Credential = { type: 'api_key'; key?: string; env?: Record<string, string> } | { type: 'oauth'; refresh: string; access: string; expires: number; [key: string]: unknown }
type CredentialInfo = { providerId: string; type: Credential['type'] }
type CredentialMap = Record<string, Credential>
type Work<T> = () => Promise<T>

export class PiCredentialStore {
  private readonly file: string
  private readonly queues = new Map<string, Promise<void>>()

  constructor(file = path.join(app.getPath('userData'), 'credentials', 'pi.bin')) {
    this.file = file
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load())[providerId]
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const credentials = await this.load()
    return Object.entries(credentials).map(([providerId, credential]) => ({ providerId, type: credential.type }))
  }

  modify(providerId: string, update: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const credentials = await this.load()
      const current = credentials[providerId]
      const next = await update(current)
      if (!next) return current
      credentials[providerId] = next
      await this.save(credentials)
      return next
    })
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      const credentials = await this.load()
      if (!credentials[providerId]) return
      delete credentials[providerId]
      await this.save(credentials)
    })
  }

  private enqueue<T>(providerId: string, work: Work<T>): Promise<T> {
    const previous = this.queues.get(providerId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.queues.set(providerId, next.then(() => undefined, () => undefined))
    return next
  }

  private async load(): Promise<CredentialMap> {
    this.assertEncryption()
    try {
      const encrypted = await readFile(this.file)
      return JSON.parse(safeStorage.decryptString(encrypted)) as CredentialMap
    } catch (error) {
      if (isMissingFile(error)) return {}
      throw new Error(`Read Pi credentials: ${errorMessage(error)}`)
    }
  }

  private async save(credentials: CredentialMap): Promise<void> {
    this.assertEncryption()
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 })
      await rename(temporary, this.file)
      await chmod(this.file, 0o600)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  private assertEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable. Unlock macOS Keychain, then configure Pi again.')
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
