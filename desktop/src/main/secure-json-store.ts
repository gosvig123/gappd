import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type StoreCipher = {
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export class SecureJsonStore<T> {
  private readonly filePath: string
  private readonly cipher: StoreCipher

  constructor(filePath: string, cipher: StoreCipher) {
    this.filePath = filePath
    this.cipher = cipher
  }

  async read(): Promise<T | null> {
    try {
      const encrypted = await readFile(this.filePath)
      return JSON.parse(this.cipher.decrypt(encrypted)) as T
    } catch (error) {
      if (isMissingFile(error)) return null
      throw new Error('Secure local data could not be read.')
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    const encrypted = this.cipher.encrypt(JSON.stringify(value))
    await writeFile(temporary, encrypted, { mode: 0o600 })
    await rename(temporary, this.filePath)
  }

  async clear(): Promise<void> {
    try { await unlink(this.filePath) }
    catch (error) { if (!isMissingFile(error)) throw new Error('Secure local data could not be removed.') }
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
